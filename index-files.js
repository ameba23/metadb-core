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
    const directories = {}
    const lowestSeq = metadb.localFeed.length
    // log('lowest seq = ', metadb.localFeed.length)
    log('Scanning directory ', dir, '...')
    // TODO write full directory path to config
    glob('**/*', { cwd: dir, nodir: false }, (err, files) => {
      if (err) return callback(err)
      pull(
        pull.values(files),
        pull.asyncMap((file, cb) => {
          console.log(file)
          fs.readFile(path.join(dir, file), (err, data) => {
            if (err) {
              if (err.errno !== -21) { // EISDIR
                log(`Error reading file ${file}, skipping.`, err)
                return cb()
              }
              console.log('directory**********',file)
              // directories.push(file)
              return cb()
            }

            const size = data.length
            if (!size) {
              log(chalk.red(`File ${file} has length 0. Skipping.`))
              return cb()
            }

            // const hash = sha256(data).toString('base64') + '.sha256'
            const hash = sha256(data).toString('hex')

            const filePath = path.dirname(file).split(path.sep)
            for (let i = 0; i < filePath.length; i++) {
              const currPath = filePath.slice(0, i + 1)
              directories[currPath] = directories[currPath] || []
              directories[currPath].push(hash)
            }

            log(
              `Extracting metadata from file: ${chalk.green(file)} of length ${chalk.green(readableBytes(size))} ${chalk.blue(hash)}`
            )
            exifExtract(data, (err, metadata) => {
              if (err) return cb(err)

              const newEntry = {
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

          console.log(directories)
          pull(
            pull.values(Object.values(directories)),
            pull.asyncMap((directory, cb) => {
              // concatonate all file hashes together
              const dirHash = sha256(Buffer.from(directory.join(''), 'hex'))
              const newEntry = {
                type: 'addDirectory',
                sha256: dirHash,
                contents: directory
                // size?
                // name?
              }
              console.log(newEntry)
              // TODO: also need to check its not already published and add timestamp
              cb(directory)
            }),
            pull.collect((err) => {
              if (err) return callback(err)

              // TODO log feedname
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
      )
    })
  }
}
