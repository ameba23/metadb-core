const pull = require('pull-stream')
const QueryAbouts = require('./query-abouts')

module.exports = function Query (metadb) {
  return { files, peers, abouts, ownFiles, filesByPeer, filenameSubstring, subdir, byExtension, byMimeCategory }

  function files () { return metadb.core.api.files.pullStream() }

  function peers (callback) {
    metadb.files.count(null, (err, counters) => {
      if (err) return callback(err)
      pull(
        pull.values(Object.keys(counters.peerFiles)),
        pull.map((peerKey) => {
          return {
            feedId: peerKey,
            numberFiles: counters.peerFiles[peerKey]
          }
        }),
        pull.asyncMap((peerObj, cb) => {
          metadb.peers.getName(peerObj.feedId, (err, name) => {
            if (!err) peerObj.name = name
            return cb(null, peerObj)
          })
        }),
        pull.collect(callback)
      )
    })
  }

  function ownFiles () { return filesByPeer(metadb.key.toString('hex')) }

  function filesByPeer (holder) { return metadb.files.pullStreamByHolder({ holder }) }

  function filenameSubstring (searchterm) {
    const substrings = searchterm.split(' ').map(s => s.toLowerCase())
    return pull(
      files(),
      pull.filter((file) => {
        var found = 0
        substrings.forEach(substring => {
          // search term beginning with ! filter results which do not contain the term
          if (substring[0] === '!') {
            if (file.filename.toLowerCase().includes(substring.slice(1))) return 0
          } else {
            if (file.filename.toLowerCase().includes(substring)) found++
          }
        })
        // TODO: sort them by 'found'
        return found
      })
    )
  }

  function subdir (subdir) {
    return metadb.files.pullStreamByPath({ subdir })
  }

  function byExtension (extensions) {
    if (typeof extensions === 'string') extensions = [extensions]
    extensions = extensions.map(e => e.toLowerCase())
    return pull(
      files(),
      pull.filter((file) => {
        // TODO lodash get
        return extensions.includes(file.filename.split('.').pop().toLowerCase())
      })
    )
  }

  function byMimeCategory (categories) {
    if (typeof categories === 'string') categories = [categories]
    return pull(
      files(),
      pull.filter((file) => {
        if (file.metadata.mimeType) {
          // TODO add special cases eg: application/pdf = document/book
          const category = file.metadata.mimeType.split('/')[0]
          return categories.includes(category)
        } else {
          // TODO determine filetype from extension
          return false
        }
      })
    )
  }

  function abouts (cb) { return QueryAbouts(metadb)(cb) }

  function ownRequests () {
    const key = metadb.key.toString('hex')
    // requests FROM me
    return metadb.requests.pullStream({
      gte: key,
      lte: key + '~'
    })
  }

  function ownRequestsPending () {
    return pull(
      ownRequests(),
      pull.filter((request) => {
        return !!request.replies
      })
    )
  }
}
