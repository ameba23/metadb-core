const pull = require('pull-stream')
const QueryFiles = require('./query-files')
const QueryAbouts = require('./query-abouts')

module.exports = function Query (metadb) {
  const custom = query
  return { files, peers, abouts, ownFiles, filesByPeer, filenameSubstring, subdir, byExtension, custom }

  function query (query, opts = {}) {
    if (!metadb.indexesReady) throw new Error('Indexes not ready, run buildIndexes')
    return pull(
      metadb.core.api.query.read(Object.assign(opts, { live: false, reverse: true, query }))
    )
  }

  function files () { return QueryFiles(metadb)() }

  function peers () {
    // TODO incorporate query-abouts
    return pull(
      query([
        { $filter: { value: { type: 'addFile' } } },
        {
          $reduce: {
            peerId: 'key',
            numberFiles: { $count: true }
          }
        }
      ]),
      pull.map((peer) => {
        peer.name = metadb.peerNames[peer.peerId]
        return peer
      })
    )
  }

  function ownFiles () { return filesByPeer(metadb.localFeed.key) }

  function filesByPeer (peerKey) {
    // TODO this is a bad query, not very efficient
    // var self = this
    function myFile (file) {
      // TODO use lodash get
      return file.holders
        ? file.holders.indexOf(peerKey.toString('hex')) > -1
        : false
    }

    return pull(
      metadb.queryFiles(),
      pull.filter(myFile)
    )
  }

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
    return pull(
      files(),
      pull.filter((file) => file.filename.slice(0, subdir.length) === subdir)
    )
  }

  function byExtension (extensions) {
    if (typeof extensions === 'string') extensions = [extensions]
    extensions = extensions.map(e => e.toLowerCase())
    return pull(
      files(),
      pull.filter((file) => {
        // TODO lodash get
        return extensions.indexOf(file.filename.split('.').pop().toLowerCase()) > -1
      })
    )
  }

  function abouts (cb) { return QueryAbouts(metadb)(cb) }
}
