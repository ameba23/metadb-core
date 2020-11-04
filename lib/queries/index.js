const pull = require('pull-stream')
const path = require('path')
const pullLevel = require('pull-level')
const confirmKey = require('confirm-key')
const Abouts = require('./query-abouts')

module.exports = function Query (metadb) {
  const query = {
    files: (options = {}) => {
      if (options.fromConnectedPeers) return query.fromConnectedPeers(query.files())
      return metadb.core.api.files.pullStream()
    },

    abouts: Abouts(metadb),

    ownFiles () {
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

    ownFilesNewestFirst () {
      return pull(
        metadb.files.pullStreamByTimestampHash({ reverse: true }),
        pull.asyncMap((hash, cb) => {
          metadb.sharedb.get(hash, (err, fileObject) => {
            if (err) return cb()
            metadb.files.get(hash, (err, file) => {
              if (err) return cb()
              file.filename = path.join(fileObject.baseDir, fileObject.filePath)
              cb(null, file)
            })
          })
        }),
        pull.filter(Boolean)
      )
    },

    filesByPeer: holder => metadb.files.pullStreamByHolder({ holder }),

    holderIsConnected (holder) {
      return Object.keys(metadb.connectedPeers).includes(holder)
    },

    fromConnectedPeersFilter (entry) {
      return entry.value.holders.some(query.holderIsConnected)
    },

    fromConnectedPeers (inputStream) {
      return pull(
        inputStream,
        pull.filter((file) => file.holders.some(query.holderIsConnected))
      )
    },

    subdir (subdir, opts = {}) {
      opts.subdir = subdir
      return opts.connectedPeersOnly
        ? metadb.files.pullStreamByHolders(Object.assign({ holders: Object.keys(metadb.connectedPeers) }, opts))
        : metadb.files.pullStreamByPath(opts)
    },

    // TODO this could maybe be speeded up by using the 'path' view
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

    // *** TODO: test this with filename array ***
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

      pull(
        pull.values(peers),
        pull.map((peerKey) => {
          // Add totals for each peer
          const peerProperties = metadb.counters[peerKey] || {}
          peerProperties.feedId = peerKey
          return peerProperties
        }),
        pull.asyncMap((peer, cb) => {
          metadb.peers.getName(peer.feedId, (err, name) => {
            peer.name = err
              ? deriveNameFromFeedId(peer.feedId)
              : name
            metadb.peerNames[peer.feedId] = peer.name

            pull(
              metadb.core.api.files.starsByHolder(peer.feedId),
              pull.collect((err, stars) => {
                if (err) return cb(err)
                peer.stars = stars
                cb(null, peer)
              })
            )
          })
        }),
        pull.collect(callback)
      )
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
