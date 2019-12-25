// const merge = require('deepmerge')
const pull = require('pull-stream')
const path = require('path')

// for my files only, given an array of hashes, return an array of filenames
// TODO:  more efficient would be first get files from hashes, then check whose they are
module.exports = function (metadb) {
  return function (hashList, callback) { // opts?
    const key = metadb.key.toString('hex')
    pull(
      metadb.files.pullStreamByHolder({ holder: key }), // TODO avoid extra gets
      pull.filter(file => hashList.includes(file.sha256)),
      pull.map(file => getFullPath(file.value.filename, file.seq, metadb.config.shares)),
      pull.collect(callback)
    )
  }
}

function getFullPath (filename, seq, shares) {
  const sharePath = shares[Object.keys(shares).find(s => s >= seq)]
  return path.join(sharePath, filename)
}

// example:  highest sequence number added
//   { 5: '~/music', 50: '/docs', 123: '~/speedcore' }
