// const merge = require('deepmerge')
const pull = require('pull-stream')
const path = require('path')

// for my files only, given an array of hashes, return an array of filenames

module.exports = function (metaDb) {
  return function (hashList, callback) { // opts?
    const key = metaDb.key.toString('hex')
    pull(
      metaDb.query([{ $filter: { key, value: { type: 'addFile' } } }]),
      pull.filter(file => hashList.indexOf(file.value.sha256) > -1),
      pull.map(file => getFullPath(file.value.filename, file.seq, metaDb.config.shares)),
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
