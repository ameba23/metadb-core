const pull = require('pull-stream')
const OwnFilesFromHashes = require('./own-files-from-hashes')
const { publish, download } = require('../transfer/dat') // publishFiles

module.exports = function (metadb) {
  return function (callback) {
    const key = metadb.key.toString('hex')

    // requests *TO* me:
    pull(
      // metadb.requests.pullNotFromFeedId(key),
      metadb.requests.pull(),
      pull.filter((request) => {
        return request.msgSeq.split('@')[0] !== key
      }),
      pull.filter((request) => {
        console.log('------------------------------REQUEST:', request)
        // TODO explicity check that we are included as a recipient?
        return request.replies
          ? request.replies.find(reply => reply.from === key)
          : true
      }),
      pull.asyncMap(processRequest),
      // pull.collect(processOwnReqests(callback))
      pull.collect(callback)
    )

    function processRequest (request, cb) {
      OwnFilesFromHashes(metadb)(request.files, (err, filePaths) => {
        console.log('filepaths:', filePaths)
        if (err || !filePaths.length) {
          // publish a reply with an error message?
          return cb() // err?
        }
        publish(filePaths, metadb.storage, (err, link, network) => {
          if (err) return cb(err) // also publish a sorry message?
          const branch = request.msgSeq
          const recipient = branch.split('@')[0]
          metadb.publish.reply(link, recipient, branch, (err, seq) => {
            if (err) return callback(err)
            // metadb.repliedTo.push(branch)
            // update index?
            cb(null, true) // null, network
          })
        })
      })
    }
  }

  function processOwnReqests (callback) {
    pull(
      metadb.requests.pullFromFeedId(metadb.keyHex),
      pull.filter((request) => {
        return (request.replies && request.replies.length)
      }),
      pull.asyncMap((request, cb) => {
        pull(
          pull.values(request.replies),
          pull.asyncMap((reply, cb2) => {
            if (!reply.closed) {
              download(reply.link, metadb.downloadPath, (err, network) => {
                if (err) return cb2(err)
                console.log(network)
                metadb.pendingDownloads.push(network) // TODO somehow check its not already there
                cb2(null, network)
              })
            }
          }),
          pull.collect(cb)
        )
      }),
      pull.collect(callback)
    )
  }
}
