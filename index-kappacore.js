const fs = require('fs')
const pull = require('pull-stream')
const chalk = require('chalk')
const path = require('path')
const glob = require('glob')
const { sha256 } = require('./crypto')
const { readableBytes } = require('./util')
const exifExtract = require('./exif-extract')

const log = console.log

module.exports = function indexKappa (metadb) {
  return function (dir, callback) {
    if (!metadb.localFeed) return callback(new Error('No local feed, call ready()'))
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
            exifExtract(data, (err, metadata) => {
              if (err) return cb(err)

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
          if (dataAdded > 0) {
             
            metadb.config.shares[highestSeq] = dir
            // TODO save to config file
            log(`added shares sequence numbers ${chalk.green(lowestSeq)} to ${chalk.green(highestSeq)}`)
          }
          // console.log('datas',JSON.stringify(datas, null,4))
          callback()
        })
      )
    })
  }
}
