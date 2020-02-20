const pull = require('pull-stream')

// for my files only, given an array of hashes,
// return an array of objects with both hashes and filenames
// TODO:  more efficient would be first get files from hashes, then check whose they are
module.exports = function (metadb) {
  return function (hashList, callback) { // opts?
    pull(
      pull.values(hashList),
      pull.asyncMap((hash, cb) => {
        metadb.sharedb.get(hash, (err, file) => {
          if (err) return cb(err)
          cb(null, { hash, file })
        })
      }),
      pull.collect(callback)
    )
  }
}
