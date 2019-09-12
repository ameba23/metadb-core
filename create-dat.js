const Dat = require('dat-node')
const fs = require('fs')
const mkdirp = require('mkdirp')
const path = require('path')
const pull = require('pull-stream')

const datPath = './adat'

const log = console.log

module.exports = function (files, callback) {
  mkdirp.sync(datPath)
  pull(
    pull.values(files),
    pull.asyncMap((file, cb) => {
      // TODO: this will throw an err if the symlink already exists
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

          log('Dat link is: dat://' + dat.key.toString('hex'))
          callback(null, dat.key)
        })
        progress.on('put', function (src, dest) {
          log('Added', dest.name)
        })
      })
    })
  )
}
