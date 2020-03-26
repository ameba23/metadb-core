const pull = require('pull-stream')
const path = require('path')
const confirmKey = require('confirm-key')
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
          metadb.sharedb.get(file.sha256, (err, fileObject) => {
            if (err) return cb(err)
            file.filename = path.join(fileObject.baseDir, fileObject.filePath)
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
        metadb.filesInDb = counters.files
        metadb.bytesInDb = counters.bytes
        pull(
          pull.values(peers),
          pull.map((peerKey) => {
            const peerProperties = counters.peerFiles
              ? counters.peerFiles[peerKey] || {}
              : {}
            peerProperties.feedId = peerKey
            return peerProperties
          }),
          pull.asyncMap((peerObj, cb) => {
            metadb.peers.getName(peerObj.feedId, (err, name) => {
              peerObj.name = err
                ? deriveNameFromFeedId(peerObj.feedId)
                : name
              metadb.peerNames[peerObj.feedId] = peerObj.name
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

function deriveNameFromFeedId (feedIdHex) {
  return confirmKey(Buffer.from(feedIdHex, 'hex'), { wordlist: 'names.json' })
}
