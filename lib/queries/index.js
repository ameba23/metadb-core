const pull = require('pull-stream')
const path = require('path')
const pullLevel = require('pull-level')
const confirmKey = require('confirm-key')
const Abouts = require('./query-abouts')

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
            const filename = Array.isArray(file.filename)
              ? file.filename.toString().toLowerCase()
              : file.filename.toLowerCase()

            // search term beginning with ! filter results which do not contain the term
            if (substring[0] === '!') {
              if (filename.includes(substring.slice(1))) return 0
            } else {
              if (filename.includes(substring)) found++
            }
          })
          // TODO: sort them by 'found'
          return found
        })
      )
    },

    // *** TODO: test this will filename array ***
    byExtension: function (extensions) {
      if (typeof extensions === 'string') extensions = [extensions]
      extensions = extensions.map(e => e.toLowerCase())
      return pull(
        query.files(),
        pull.filter((file) => {
          const filename = Array.isArray(file.filename)
            ? file.filename
            : [file.filename]

          const fileExtensions = filename.map(f => f.split('.').pop().toLowerCase())
          return fileExtensions.filter(extension => extensions.includes(extension)).length
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
    // TODO invites query

    requesting: function () {
      return pull(
        // currently gives objects: { key: hash(hex) value: { open: true } }
        pullLevel.read(metadb.requestsdb), // {live: true}
        pull.map(kv => kv.key),
        pull.asyncMap(metadb.files.get)
      )
    }
  }
  return query
}

function deriveNameFromFeedId (feedIdHex) {
  return confirmKey(Buffer.from(feedIdHex, 'hex'), { wordlist: 'names.json' })
}