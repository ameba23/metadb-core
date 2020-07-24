const fs = require('fs')
const pull = require('pull-stream')
const chalk = require('chalk')
const path = require('path')
const glob = require('glob')
const extract = require('metadata-extract')
const homeDir = require('os').homedir()

const ignore = require('./ignore.js')
const { Sha256Instance } = require('./crypto')
const { readableBytes } = require('./util')
const noop = function () {}

// Index a given directory, extracting metadata from media files
// TODO add a listener for pause/resume, cancel events

module.exports = function indexFiles (metadb) {
  // Add files in the given directory to the index
  return function (dir, opts = {}, onStarting, onFinished) {
    if (!metadb.localFeed) return onStarting(new Error('No local feed, call ready()'))
    if (typeof opts === 'function' && !onFinished) {
      onFinished = onStarting || noop
      onStarting = opts
      opts = {}
    }
    if (dir === homeDir) return onStarting(new Error('You may not index your entire home directory'))
    onStarting()
    // TODO if indexing is already true, put this dir on the queue
    if (metadb.indexing) {
      metadb.indexQueue.push(dir) // or { dir, onFinished }
      return onStarting() // err?
    }
    metadb.indexing = dir

    const defaultLog = function (data) {
      console.log(data)
      metadb.emitWs({ indexer: data + '\n' })
    }
    const log = opts.log || defaultLog

    ignore.setup(() => {
      let dataAdded = 0
      let dataParsed = 0

      log(`Scanning directory ${dir}...`)
      glob('**/*', { cwd: dir, nodir: true }, (err, files) => {
        if (err) return onFinished(err)

        pull(
          pull.values(files),
          pull.filter(ignore.filesWeWant),
          pull.asyncMap((file, cb) => {
            if (metadb.abortIndexing) {
              metadb.abortIndexing = false
              return cb(new Error('Abort called'))
            }
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
                log(chalk.red(`File ${file} has length 0. Skipping.`))
                return cb()
              }
              log(
                `Extracting metadata from: ${chalk.green(file)} length: ${chalk.green(readableBytes(size))} ${chalk.blue(hash.slice(-4).toString('hex'))}`
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
                if (err) return cb(err) // or just carry on?
                gotMetadata = metadata
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
              metadb.indexProgress = ~~((dataParsed / files.length) * 100)
              console.log(metadb.indexProgress)

              // Check if an identical entry exists in the feed
              // TODO this could maybe be speeded up by first checking metadb.sharedb.get(hash)
              let duplicate = false
              const feedStream = metadb.localFeed.createReadStream({ live: false })

              feedStream.on('error', cb)

              feedStream.on('data', (data) => {
                const dataObj = data.addFile

                // To speed things up by not stringifying every entry
                if (!dataObj || (dataObj.sha256.compare(newEntry.sha256) !== 0)) return
                // if (isEqual(newEntry, data)) { //lodash doesnt seem to work here
                // TODO: use deepmerge
                if (JSON.stringify(dataObj) === JSON.stringify(newEntry)) { // bad solution
                  duplicate = true
                  log(chalk.red('File already exists in index, skipping...'))
                  feedStream.destroy()
                  cb(null, newEntry)
                }
              })

              feedStream.on('end', () => {
                if (!duplicate) {
                  metadb.publish.publishMessage(newEntry, 'addFile', (err, seq) => {
                    if (err) throw err // TODO
                    log('Data was appended as entry #' + seq)
                    dataAdded += 1
                    metadb.sharedb.put(hash.toString('hex'), { baseDir: dir, filePath: file }, (err) => {
                      if (err) return cb(err)
                      cb(null, newEntry)
                    })
                  })
                }
              })
            }
          }),
          pull.collect((err, datas) => {
            metadb.indexing = false
            // TODO: don't need to complain if just one file wouldnt read
            if (err) return onFinished(err)

            log(`Feed key ${chalk.green(metadb.localFeed.key.toString('hex'))}`)
            log(`Number of files parsed: ${chalk.green(datas.length)}`)
            log(`Number of metadata added: ${chalk.green(dataAdded)}`)
            metadb.shareTotals.put(dir, dataAdded, (err) => {
              if (err) return onFinished(err)
              onFinished(null, {
                filesParsed: datas.length,
                metadataAdded: dataAdded
              })
              if (metadb.indexQueue.length) metadb.indexFiles(metadb.indexQueue.shift(), {}, noop, noop)
            })
          })
        )
      })
    })
  }
}
