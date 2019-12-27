const pull = require('pull-stream')
const Abouts = require('./query-abouts')
const RequestReply = require('./request-reply')

module.exports = function Query (metadb) {
  const queries = {
    files: () => metadb.core.api.files.pullStream(),

    abouts: Abouts(metadb),

    ownFiles: () => queries.filesByPeer(metadb.key.toString('hex')),

    filesByPeer: holder => metadb.files.pullStreamByHolder({ holder }),

    subdir: subdir => metadb.files.pullStreamByPath({ subdir }),

    requestReply: RequestReply(metadb),

    filenameSubstring: function filenameSubstring (searchterm) {
      const substrings = searchterm.split(' ').map(s => s.toLowerCase())
      return pull(
        queries.files(),
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
    },

    byExtension: function (extensions) {
      if (typeof extensions === 'string') extensions = [extensions]
      extensions = extensions.map(e => e.toLowerCase())
      return pull(
        queries.files(),
        pull.filter((file) => {
          // TODO lodash get
          return extensions.includes(file.filename.split('.').pop().toLowerCase())
        })
      )
    },

    peers: function (callback) {
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
    },

    byMimeCategory: function (categories) {
      if (typeof categories === 'string') categories = [categories]
      return pull(
        queries.files(),
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
  }
  return queries
  // TODO move this to the view
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
