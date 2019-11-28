const fs = require('fs')
const pull = require('pull-stream')
const chalk = require('chalk')
const path = require('path')
const glob = require('glob')
const { sha256 } = require('./crypto')
const { readableBytes } = require('./util')
const exifExtract = require('./exif-extract')
const mimeExtract = require('./mime-extract')
const fileType = require('file-type')

const ignore = require('./ignore.js')

const log = console.log

const defaultExtractors = [mimeExtract]

module.exports = function indexKappa (metadb) {
  return function (dir, extractors, callback) {
    if (!metadb.localFeed) return callback(new Error('No local feed, call ready()'))
    if (typeof extractors === 'function' && !callback) {
      callback = extractors
      extractors = null
    }
    extractors = extractors || defaultExtractors
    ignore.setup(() => {
      var highestSeq
      var dataAdded = 0
      const lowestSeq = metadb.localFeed.length
      // log('lowest seq = ', metadb.localFeed.length)
      log('Scanning directory ', dir, '...')
      // TODO write full directory path to config
      glob('**/*', { cwd: dir, nodir: true }, (err, files) => {
        if (err) return callback(err)
        pull(
          pull.values(files),
          pull.filter(ignore.filesWeWant),
          pull.asyncMap((file, cb) => {
            fs.readFile(path.join(dir, file), (err, data) => {
              if (err) {
                log(`Error reading file ${file}, skipping.`)
                return cb()
              }
              const size = data.length
              if (!size) {
                log(chalk.red(`File ${file} has length 0. Skipping.`))
                return cb()
              }
              // const hash = sha256(data).toString('base64') + '.sha256'
              const hash = sha256(data).toString('hex')
              log(
                `Extracting metadata from file: ${chalk.green(file)} of length ${chalk.green(readableBytes(size))} ${chalk.blue(hash)}`
              )
              extract(data, (err, metadata) => {
                if (err) return cb(err) // or just carry on?

                var newEntry = {
                  type: 'addFile',
                  sha256: hash,
                  filename: file,
                  size,
                  metadata
                }
                var duplicate = false
                // check if an identical entry exists in the feed
                const feedStream = metadb.localFeed.createReadStream({ live: false })
                feedStream.on('data', (data) => {
                  delete data.timestamp
                  // if (isEqual(newEntry, data)) { //lodash doesnt seem to work here
                  // TODO: use deepmerge
                  if (JSON.stringify(data) === JSON.stringify(newEntry)) { // bad solution
                    duplicate = true
                    log(chalk.red('File already exists in index, skipping...'))
                    feedStream.destroy()
                    cb(null, newEntry)
                  }
                })
                feedStream.on('end', () => {
                  if (!duplicate) {
                    newEntry.timestamp = Date.now()
                    metadb.localFeed.append(newEntry, (err, seq) => {
                      if (err) throw err
                      log('Data was appended as entry #' + seq)
                      highestSeq = seq
                      dataAdded += 1
                      cb(null, newEntry)
                    })
                  }
                })
              })
            })
          }),
          pull.collect((err, datas) => {
            // TODO: don't need to complain if just one file wouldnt read
            if (err) return callback(err)
            // todo log feedname
            log('Feed key ', chalk.green(metadb.localFeed.key.toString('hex')))
            log('Number of files parsed: ', chalk.green(datas.length))
            log('Number of metadata added: ', chalk.green(dataAdded))
            if (dataAdded < 1) return callback()
            metadb.loadConfig((err) => {
              if (err) return callback(err)
              metadb.config.shares[highestSeq] = path.resolve(dir)
              log(`added shares sequence numbers ${chalk.green(lowestSeq)} to ${chalk.green(highestSeq)}`)
              metadb.writeConfig(callback)
            })
          })
        )
      })
    })
    function extract (data, callback) { // ext
      const mimeType = getMimeType(data)
      const metadata = { mimeType }
      pull(
        pull.values(extractors),
        pull.asyncMap((extractor, cb) => {
          extractor(data, mimeType, cb)
        }),
        pull.collect((err, metadatas) => {
          if (err) return callback(err)
          Object.assign(metadata, ...metadatas)
          callback(null, metadata)
        })
      )
    }

    function getMimeType (data) {
      // TODO: file-type can also take a stream
      return (data.length >= fileType.minimumbytes)
        ? fileType(data).mime
        : undefined
    }
  }
}
