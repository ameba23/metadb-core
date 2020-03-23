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
const { isAddFile } = require('./schemas') // TODO

const SCHEMAVERSION = '1.0.0'
module.exports = function indexFiles (metadb) {
  return function (dir, opts = {}, callback) {
    if (!metadb.localFeed) return callback(new Error('No local feed, call ready()'))
    if (typeof opts === 'function' && !callback) {
      callback = opts
      opts = {}
    }
    if (dir === homeDir) return callback(new Error('You may not index your entire home directory'))
    const log = opts.log || console.log
    ignore.setup(() => {
      var highestSeq
      var dataAdded = 0
      const lowestSeq = metadb.localFeed.length
      log('Scanning directory ', dir, '...')
      glob('**/*', { cwd: dir, nodir: true }, (err, files) => {
        if (err) return callback(err)
        pull(
          pull.values(files),
          pull.filter(ignore.filesWeWant),
          pull.asyncMap((file, cb) => {
            const filename = path.join(dir, file)
            log(`Extracting metadata from: ${chalk.green(file)}`)
            // length: ${chalk.green(readableBytes(size))} ${chalk.blue(hash.slice(-8))}`
            let size = 0
            let hash
            let gotMetadata
            const sha256Instance = new Sha256Instance()
            // TODO put this inside try/catch
            const readStream = fs.createReadStream(filename)
            readStream.on('data', (chunk) => {
              sha256Instance.update(chunk)
              size += chunk.length
            })
            readStream.on('close', () => {
              // const hash = sha256(data).toString('hex')
              hash = sha256Instance.final().toString('hex')
              if (!size) {
                log(chalk.red(`File ${file} has length 0. Skipping.`))
                return cb()
              }
              if (gotMetadata) {
                publishMetadata()
              }
            })
            extract(filename, (err, metadata) => {
              if (err) return cb(err) // or just carry on?
              gotMetadata = metadata
              if (hash) {
                publishMetadata()
              }
            })
            function publishMetadata () {
              const newEntry = {
                type: 'addFile',
                sha256: hash,
                filename: file,
                version: SCHEMAVERSION,
                size,
                metadata: gotMetadata
              }
              let duplicate = false
              // check if an identical entry exists in the feed
              const feedStream = metadb.localFeed.createReadStream({ live: false })
              feedStream.on('data', (data) => {
                delete data.timestamp
                // To speed things up by not stringifying every entry
                if (data.sha256 === newEntry.sha256) {
                  // if (isEqual(newEntry, data)) { //lodash doesnt seem to work here
                  // TODO: use deepmerge
                  if (JSON.stringify(data) === JSON.stringify(newEntry)) { // bad solution
                    duplicate = true
                    log(chalk.red('File already exists in index, skipping...'))
                    feedStream.destroy()
                    cb(null, newEntry)
                  }
                }
              })

              feedStream.on('end', () => {
                if (!duplicate) {
                  newEntry.timestamp = Date.now()
                  // if (!isAddFile(newEntry)) return cb(error...)
                  metadb.localFeed.append(newEntry, (err, seq) => {
                    if (err) throw err
                    log('Data was appended as entry #' + seq)
                    // highestSeq = seq
                    dataAdded += 1
                    metadb.sharedb.put(hash, path.join(dir, file), (err) => {
                      if (err) return cb(err)
                      cb(null, newEntry)
                    })
                  })
                }
              })
            }
          }),
          pull.collect((err, datas) => {
            // TODO: don't need to complain if just one file wouldnt read
            if (err) return callback(err)
            // todo log feedname
            log('Feed key ', chalk.green(metadb.localFeed.key.toString('hex')))
            log('Number of files parsed: ', chalk.green(datas.length))
            log('Number of metadata added: ', chalk.green(dataAdded))
            metadb.shareTotals.put(dir, dataAdded, (err) => {
              if (err) return callback(err)
              callback(null, {
                filesParsed: datas.length,
                metadataAdded: dataAdded
              })
            })
          })
        )
      })
    })
  }
}
