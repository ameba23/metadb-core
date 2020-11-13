const fs = require('fs')
const path = require('path')
const extract = require('metadata-extract')
const homeDir = require('os').homedir()
const walk = require('./fs-walk')
// const { inspect } = require('util')
const { createHash } = require('crypto')
// const { Sha256Instance } = require('./crypto')
const { readableBytes } = require('./util')
const noop = function () {}

// Index a given directory, extracting metadata from media files
// TODO for windows support use normalize-path or unixify to convert paths

module.exports = function indexFiles (metadb) {
  // Add files in the given directory to the index
  return function (dir, opts = {}, onStarting, onFinished = noop) {
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
      metadb.sharedb.createValueStream()
        .on('data', (existingFile) => {
          if (existingFile.baseDir === dir) {
            alreadyIndexed.push(existingFile.filePath)
          }
        })
        .on('error', onFinished)
        .on('end', () => {
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

      const processFile = function (file, cb) {
        dataParsed += 1
        if (metadb.abortIndexing) {
          metadb.abortIndexing = false
          metadb.emitWs({ indexingFiles: false })
          // TODO destroy globStream?
          return cb(new Error('Abort called'))
        }
        if ((!opts.rebuild) && alreadyIndexed.includes(file)) return cb()

        const filename = path.join(dir, file)
        const size = fs.statSync(filename).size
        if (!size) {
          log(`File ${file} has length 0. Skipping.`)
          return cb()
        }

        const readStream = fs.createReadStream(filename)
        const hashInstance = createHash('sha256')

        readStream.on('end', function () {
          const hash = hashInstance.end().read()
          log(
            `Extracting metadata from: ${file} length: ${readableBytes(size)} ${hash.slice(-4).toString('hex')}`
          )
          if (opts.skipExtraction) {
            publishMetadata(hash, {})
          } else {
            extract(filename, (err, metadata) => {
              if (err) log(`Error from extractor: ${err.message} ${err.stack}`)
              publishMetadata(hash, err ? {} : metadata)
            })
          }
        })

        readStream.on('error', () => { return cb() })
        readStream.pipe(hashInstance)

        function publishMetadata (hash, gotMetadata) {
          const newEntry = {
            sha256: hash,
            filename: file,
            size,
            metadata: JSON.stringify(gotMetadata)
          }

          checkForDuplicateEntries(newEntry, (err, isDuplicate) => {
            if (err) return cb(err)
            if (isDuplicate) {
              log('File already exists in index, skipping...')
              return cb()
            }

            metadb.publish.publishMessage(newEntry, 'addFile', (err, seq) => {
              if (err) throw err // TODO
              log('Data was appended as entry #' + seq)
              metadb.emitWs({ sharedbUpdated: true })
              dataAdded += 1
              bytesAdded += size
              metadb.sharedb.put(hash.toString('hex'), { baseDir: dir, filePath: file }, (err) => {
                if (err) return cb(err)
                cb()
              })
            })
          })
        }
      }

      walk(dir, processFile, { ignorePatterns: metadb.ignorePatterns }, (err) => {
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
    }
  }

  function checkForDuplicateEntries (newEntry, callback) {
    // Check if an identical entry exists in the feed
    metadb.sharedb.get(newEntry.sha256.toString('hex'), (err) => {
      if (err) return callback(null, false)

      // Check all entries in the stream
      const feedStream = metadb.localFeed.createReadStream({ live: false })
      feedStream.on('error', (err) => {
        return callback(err)
      })
      feedStream.on('data', (data) => {
        const dataObj = data.addFile
        // To speed things up by not stringifying every entry
        if (!dataObj || (dataObj.sha256.compare(newEntry.sha256) !== 0)) return
        // if (isEqual(newEntry, data)) { //lodash doesnt seem to work here
        // TODO: use deepmerge
        if (JSON.stringify(dataObj) === JSON.stringify(newEntry)) { // bad solution
          feedStream.destroy()
          return callback(null, true)
        }
      })

      feedStream.on('end', () => {
        return callback(null, false)
      })
    })
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
