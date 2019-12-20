const pull = require('pull-stream')
const QueryFiles = require('./query-files')
const QueryAbouts = require('./query-abouts')
const { isRequest, isReply } = require('../schemas')

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
      files(),
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
      pull.filter((file) => file.filename.slice(0, subdir.length) === subdir),
      pull.map((a) => { console.log(a); return a })
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

  function ownRequests () {
    const key = metadb.key.toString('hex')
    return pull(
      // requests FROM me
      metadb.query.custom([{ $filter: { key, value: { type: 'request' } } }]),
      pull.filter(msg => isRequest(msg.value))
    )
  }

  function ownRequestsPending () {
    const key = metadb.key.toString('hex')
    return pull(
      ownRequests(),
      pull.filter((request) => {
        const branchString = `${request.key}@${request.seq}`
        pull(
          // Replies FROM others
          metadb.query.custom([{ $filter: { key: { $ne: key }, value: { type: 'reply' } } }]),
          pull.filter(msg => isReply(msg.value)),
          pull.map(msg => msg.value.branch),
          pull.filter(replyBranch => replyBranch === branchString),
          pull.collect((err, replies) => {
            if (err) throw err
            return replies.length
          })
        )
      })
    )
  }
}
