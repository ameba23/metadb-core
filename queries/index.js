const pull = require('pull-stream')
const Abouts = require('./query-abouts')
const ProcessRequestsFromOthers = require('./processRequestsFromOthers')
const ProcessRequestsFromSelf = require('./processRequestsFromSelf')

module.exports = function Query (metadb) {
  const query = {
    files: () => metadb.core.api.files.pullStream(),

    abouts: Abouts(metadb),

    ownFiles: () => {
      return pull(
        query.filesByPeer(metadb.keyHex),
        pull.asyncMap((file, cb) => {
          metadb.sharedb.get(file.sha256, (err, filename) => {
            if (err) return cb(err)
            file.filename = filename
            cb(null, file)
          })
        })
      )
    },

    filesByPeer: holder => metadb.files.pullStreamByHolder({ holder }),

    subdir: subdir => metadb.files.pullStreamByPath({ subdir }),

    filenameSubstring: function filenameSubstring (searchterm) {
      const substrings = searchterm.split(' ').map(s => s.toLowerCase())
      return pull(
        query.files(),
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
        query.files(),
        pull.filter((file) => {
          // TODO lodash get
          return extensions.includes(file.filename.split('.').pop().toLowerCase())
        })
      )
    },

    peers: function (callback) {
      const peers = metadb.core.feeds().map(f => f.key.toString('hex'))

      metadb.files.count(null, (err, counters) => {
        if (err) return callback(err)
        pull(
          pull.values(peers),
          pull.map((peerKey) => {
            const numberFiles = counters.peerFiles ? counters.peerFiles[peerKey] : undefined
            return {
              feedId: peerKey,
              numberFiles
            }
          }),
          pull.asyncMap((peerObj, cb) => {
            metadb.peers.getName(peerObj.feedId, (err, name) => {
              if (!err) peerObj.name = name
              metadb.peerNames[peerObj.feedId] = name
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
        query.files(),
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
    },

    requestsFromOthers: function () {
      return pull(
        // TODO metadb.requests.pullNotFromFeedId(key),
        metadb.requests.pull(),
        pull.filter((request) => {
          return request.msgSeq.split('@')[0] !== metadb.keyHex
        })
      )
    },

    requestsFromSelf: () => metadb.requests.pullFromFeedId(metadb.keyHex),

    processRequestsFromOthers: ProcessRequestsFromOthers(metadb),
    processRequestsFromSelf: ProcessRequestsFromSelf(metadb)
  }
  return query
}
