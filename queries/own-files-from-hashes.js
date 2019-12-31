const pull = require('pull-stream')

// for my files only, given an array of hashes, return an array of filenames
// TODO:  more efficient would be first get files from hashes, then check whose they are
module.exports = function (metadb) {
  return function (hashList, callback) { // opts?
    pull(
      pull.values(hashList),
      pull.asyncMap((hash, cb) => {
        metadb.sharedb.get(hash, cb)
      }),
      pull.collect(callback)
    )
  }
}
