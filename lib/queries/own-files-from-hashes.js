const pull = require('pull-stream')

// For my files only, given an array of hashes,
// return an array of objects with both hashes and filenames

module.exports = function (metadb) {
  return function (hashList, callback) { // opts?
    pull(
      pull.values(hashList),
      pull.asyncMap((hash, cb) => {
        metadb.sharedb.get(hash, (err, fileObject) => {
          if (err) return cb(null, { notFound: hash })
          cb(null, Object.assign(fileObject, { hash }))
        })
      }),
      pull.collect(callback)
    )
  }
}
