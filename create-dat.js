const Dat = require('dat-node')
const fs = require('fs')
const mkdirp = require('mkdirp')
const path = require('path')
const pull = require('pull-stream')

const dat_path = './adat'

const log = console.log

// module.exports = function (hashes) {}
module.exports = function(files, callback) {
  mkdirp.sync(dat_path)
  pull(
    pull.values(files),
    pull.asyncMap((file, cb) => {
      // TODO: this will throw an err if the symlink already exists
      fs.symlink(file, path.join(dat_path, path.basename(file)), cb)
    }),
    pull.collect((err, done) => {
      if (err) return cb(err)
      Dat(dat_path, (err, dat) => {
        if (err) return cb(err)
        const progress = dat.importFiles(dat_path, (err) => {
          if (err) return cb(err)
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
