// const merge = require('deepmerge')
const pull = require('pull-stream')
const path = require('path')

// for my files only, given an array of hashes, return an array of filenames
// TODO:  more efficient would be first get files from hashes, then check whose they are
module.exports = function (metadb) {
  return function (hashList, callback) { // opts?
    console.log('hashlist', hashList)
    const key = metadb.key.toString('hex')
    pull(
      pull.values(hashList),
      pull.asyncMap((hash, cb) => {
        console.log('hash to get', hash)
        metadb.sharedb.get(hash, cb)
      }),
      pull.filter((f) => {
        console.log(f)
        return true
      }),
      pull.collect(callback)
    )
  }
}

// function getFullPath (filename, seq, shares) {
//   const sharePath = shares[Object.keys(shares).find(s => s >= seq)]
//   return path.join(sharePath, filename)
// }

// example:  highest sequence number added
//   { 5: '~/music', 50: '/docs', 123: '~/speedcore' }
