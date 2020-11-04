const fs = require('fs')
const pull = require('pull-stream')
const toPull = require('stream-to-pull-stream')
const path = require('path')
const glob = require('fast-glob')
const extract = require('metadata-extract')
const homeDir = require('os').homedir()
// const { inspect } = require('util')

const { Sha256Instance } = require('./crypto')
const { readableBytes } = require('./util')
const noop = function () {}

// Index a given directory, extracting metadata from media files
// TODO add a listener for pause/resume, cancel events
// TODO for windows support use normalize-path or unixify to convert paths

module.exports = function indexFiles (metadb) {
  // Add files in the given directory to the index
  return function (dir, opts = {}, onStarting, onFinished) {
    console.log('ffff', dir)
    if (!metadb.localFeed) return onStarting(new Error('No local feed, call ready()'))
    if (typeof opts === 'function' && !onFinished) {
      onFinished = onStarting || noop
      onStarting = opts
      opts = {}
    }
    if (dir === homeDir) return onStarting(new Error('You may not index your entire home directory'))
    // TODO if indexing is already true, put this dir on the queue

    // Add this item to the queue
    if (!metadb.indexQueue.includes(dir)) {
      metadb.indexQueue.push(dir)
      metadb.emitWs({ indexQueue: metadb.indexQueue })
      metadb.storeIndexQueue.put('i', metadb.indexQueue)
    }
    // Do nothing if we are already indexing
    if (metadb.indexing) return onStarting() // err?

    metadb.indexing = dir
    onStarting()

    const alreadyIndexed = []
    if (opts.rebuild) {
      ready()
    } else {
      const valueStream = metadb.sharedb.createValueStream()
      valueStream.on('data', (existingFile) => {
        if (existingFile.baseDir === dir) {
          alreadyIndexed.push(existingFile.filePath)
        }
      })
      valueStream.on('error', onFinished)
      valueStream.on('end', () => {
        ready()
      })
    }

    function ready () {
      const defaultLog = function (data) {
        console.log(data)
        metadb.emitWs({ indexer: data + '\n' })
      }
      const log = opts.log || defaultLog

      let dataAdded = 0
      let dataParsed = 0
      let bytesAdded = 0

      metadb.emitWs({ indexingFiles: dir })
      log(`Scanning directory ${dir}...`)
      const globStream = glob.stream(['**/*'], { cwd: dir, ignore: metadb.ignorePatterns })

      globStream.on('error', (err) => {
        return onFinished(err)
      })
      pull(
        toPull.source(globStream),
        pull.asyncMap((file, cb) => {
          dataParsed += 1
          if (metadb.abortIndexing) {
            metadb.abortIndexing = false
            metadb.emitWs({ indexingFiles: false })
            return cb(new Error('Abort called'))
          }
          if ((!opts.rebuild) && alreadyIndexed.includes(file)) return cb()

          const filename = path.join(dir, file)
          let size = 0
          let hash
          let gotMetadata
          const sha256Instance = new Sha256Instance()
          const readStream = fs.createReadStream(filename)
          readStream.on('data', (chunk) => {
            sha256Instance.update(chunk)
            size += chunk.length
          })
          readStream.on('close', () => {
            hash = sha256Instance.final()
            if (!size) {
              log(`File ${file} has length 0. Skipping.`)
              return cb()
            }
            log(
              `Extracting metadata from: ${file} length: ${readableBytes(size)} ${hash.slice(-4).toString('hex')}`
            )
            if (gotMetadata) {
              publishMetadata()
            }
          })
          readStream.on('error', () => { return cb() })

          if (opts.skipExtraction) {
            gotMetadata = {}
            if (hash) publishMetadata()
          } else {
            extract(filename, (err, metadata) => {
              if (err) log(`Error from extractor: ${err.message} ${err.stack}`)
              gotMetadata = err ? {} : metadata // TODO include warning?
              if (hash) publishMetadata()
            })
          }

          function publishMetadata () {
            const newEntry = {
              sha256: hash,
              filename: file,
              size,
              metadata: JSON.stringify(gotMetadata)
            }
            dataParsed += 1
            // metadb.indexProgress = ~~((dataParsed / files.length) * 100)
            // console.log(metadb.indexProgress)

            // Check if an identical entry exists in the feed
            // TODO this could maybe be speeded up by first checking metadb.sharedb.get(hash)
            let duplicate = false
            const feedStream = metadb.localFeed.createReadStream({ live: false })
            feedStream.on('error', (err) => {
              log('Error reading local feed')
              return cb(err)
            })
            feedStream.on('data', (data) => {
              const dataObj = data.addFile
              // To speed things up by not stringifying every entry
              if (!dataObj || (dataObj.sha256.compare(newEntry.sha256) !== 0)) return
              // if (isEqual(newEntry, data)) { //lodash doesnt seem to work here
              // TODO: use deepmerge
              if (JSON.stringify(dataObj) === JSON.stringify(newEntry)) { // bad solution
                duplicate = true
                log('File already exists in index, skipping...')
                feedStream.destroy()
                cb(null, newEntry)
              }
            })

            feedStream.on('end', () => {
              if (!duplicate) {
                metadb.publish.publishMessage(newEntry, 'addFile', (err, seq) => {
                  if (err) throw err // TODO
                  log('Data was appended as entry #' + seq)
                  metadb.emitWs({ sharedbUpdated: true })
                  dataAdded += 1
                  bytesAdded += size
                  metadb.sharedb.put(hash.toString('hex'), { baseDir: dir, filePath: file }, (err) => {
                    if (err) return cb(err)
                    cb(null, newEntry)
                  })
                })
              }
            })
          }
        }),
        pull.collect((err) => {
          if (metadb.abortIndexing) {
            if (typeof metadb.abortIndexing === 'function') metadb.abortIndexing()
            metadb.abortIndexing = false
          }
          metadb.indexing = false
          if (err) return onFinished(err) // todo aborted? dont cb yet

          log(`Number of files parsed: ${dataParsed}`)
          log(`Number of metadata added: ${dataAdded}`)
          metadb.emitWs({ updateTotals: true })

          metadb.shareTotals.get(dir, (err, existingEntry) => {
            const newEntry = {
              numberFiles: err ? dataAdded : existingEntry.numberFiles + dataAdded,
              bytes: err ? bytesAdded : existingEntry.bytesAdded + bytesAdded
            }
            metadb.shareTotals.put(dir, newEntry, (err) => {
              if (err) return onFinished(err)
              onFinished(null, {
                filesParsed: dataParsed,
                metadataAdded: dataAdded
              })

              // Rm this item from the queue
              metadb.indexQueue = metadb.indexQueue.filter(d => d !== dir)

              if (metadb.indexQueue.length) {
                metadb.indexFiles(metadb.indexQueue.shift(), {}, noop, noop)
              } else {
                metadb.emitWs({ indexingFiles: false })
              }
              metadb.emitWs({ indexQueue: metadb.indexQueue })
              metadb.storeIndexQueue.put('i', metadb.indexQueue)
            })
          })
        })
      )
    }
  }
}
// function logEvents (emitter, name) {
//   let emit = emitter.emit
//   name = name ? `(${name}) ` : ''
//   emitter.emit = (...args) => {
//     console.log(`\x1b[33m${args[0]}\x1b[0m`, inspect(args.slice(1), { depth: 1, colors: true }))
//     emit.apply(emitter, args)
//   }
// }
