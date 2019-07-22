const Dat = require('dat-node')
const fs = require('fs')
const mkdirp = require('mkdirp')
const path = require('path')
const pull = require('pull-stream')

const dat_path = './adat'

// module.exports = function (hashes) {}
module.exports = function(files) {
  mkdirp.sync(dat_path)
  pull(
    pull.values(files),
    pull.asyncMap((file, cb) => {
      // note: this will throw an err if the symlink already exists
      fs.symlink(file, path.join(dat_path, path.basename(file)), cb)
    }),
    pull.collect((err, done) => {
      if (err) throw err
      Dat(dat_path, (err, dat) => {
        if (err) throw err
        dat.importFiles()

        dat.joinNetwork()
        console.log('My Dat link is: dat://' + dat.key.toString('hex'))
      })
    })
  )
}
