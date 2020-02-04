const Dat = require('dat-node')
const fs = require('fs')
const mkdirp = require('mkdirp')
const path = require('path')
const pull = require('pull-stream')

const log = console.log

module.exports = { publish, download }

function publish (files, baseDir, callback) {
  const datPath = path.join(baseDir, 'pending')
  mkdirp.sync(datPath)
  pull(
    pull.values(files),
    pull.asyncMap((file, cb) => {
      // TODO: this will throw an err if the symlink already exists
      // TODO: with many files, we will loose the dir structure by doing path.basename
      // if we have at least 2 files with a common portion of their path, we should break
      // at the common part
      fs.symlink(file, path.join(datPath, path.basename(file)), (err) => {
        // if (err && err.code === 'EEXIST') { return cb() }
        cb(err)
      })
    }),
    pull.collect((err, done) => {
      if (err) return callback(err)
      Dat(datPath, (err, dat) => {
        if (err) return callback(err)
        const progress = dat.importFiles(datPath, (err) => {
          if (err) return callback(err)
          const datNetwork = dat.joinNetwork()
          // const datNetwork = false
          log('Finished importing')
          log('Archive size:', dat.archive.content.byteLength)
          const link = 'dat://' + dat.key.toString('hex')
          log(`Dat link is: ${link}`)
          callback(null, link, datNetwork)
        })
        progress.on('put', function (src, dest) {
          log('Added', dest.name)
        })
      })
    })
  )
}

function download (link, downloadPath, callback) {
  // const datPath = path.join(baseDir, 'downloads')
  if (link.slice(0, 6) === 'dat://') link = link.slice(6)
  // TODO isHexString(link, 32) if not, remove the trailing path, open with sparse: true, and do archive.readFile
  Dat(downloadPath, { key: Buffer.from(link, 'hex') }, (err, dat) => {
    if (err) return callback(err)
    dat.joinNetwork((err) => {
      if (err) return callback(err)
      if (!dat.network.connected || !dat.network.connecting) {
        log('Download dat: it looks like no peers are currently online.')
      }
      callback(null, dat)
    })
  })
}
