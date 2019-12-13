const Dat = require('dat-node')
const fs = require('fs')
const mkdirp = require('mkdirp')
const path = require('path')
const pull = require('pull-stream')

const basedir = '.' // TODO

const log = console.log

module.exports = function (files, callback) {
  const datPath = path.join(basedir, 'pending')
  mkdirp.sync(datPath)
  pull(
    pull.values(files),
    pull.asyncMap((file, cb) => {
      // TODO: this will throw an err if the symlink already exists
      // TODO: with many files, we will loose the dir structure by doing path.basename
      // if we have at least 2 files with a common portion of their path, we should break
      // at the common part
      fs.symlink(file, path.join(datPath, path.basename(file)), cb)
    }),
    pull.collect((err, done) => {
      if (err) return callback(err)
      Dat(datPath, (err, dat) => {
        if (err) return callback(err)
        const progress = dat.importFiles(datPath, (err) => {
          if (err) return callback(err)
          log('Finished importing')
          log('Archive size:', dat.archive.content.byteLength)
          const link = 'dat://' + dat.key.toString('hex')
          log(`Dat link is: ${link}`)
          callback(null, link)
        })
        progress.on('put', function (src, dest) {
          log('Added', dest.name)
        })
      })
    })
  )
}
