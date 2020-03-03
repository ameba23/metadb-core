const pull = require('pull-stream')
const path = require('path')
const { download } = require('../transfer/hypercore-sendfile') // publishFiles
const log = console.log // debug

module.exports = function (metadb) {
  return function (callback) {
    pull(
      metadb.requests.pullFromFeedId(metadb.keyHex),
      pull.filter((request) => {
        return (request.replies && request.replies.length)
      }),
      pull.asyncMap((request, cb) => {
        pull(
          pull.values(request.replies),
          pull.asyncMap((reply, cb2) => {
            if (!request.closed) {
              // hash to filename / folder
              // just take the first file for now, but eventually this will be
              // an asyncmap
              metadb.files.get(request.files[0], (err, requestedFileMetadata) => {
                if (err) {
                  return cb2(err)
                  // we should allow requesting for files we dont know about
                  // filename = request.files[0] // name it with the hash?
                }
                const filePath = path.join(metadb.downloadPath, requestedFileMetadata.filename)
                download(reply.link, filePath, onDownloaded, (err, network) => {
                  if (err) return cb2(err)
                  // metadb.pendingDownloads.push(network) // TODO somehow check its not already there
                  cb2(null, network)
                })

                function onDownloaded (hashToCheck) {
                  if (hashToCheck.toString('hex') === request.files[0]) {
                    log('downloaded file verified')
                  } else {
                    log('downloaded file hash does not match requested!')
                  }
                  metadb.requests.update(request.msgSeq, { closed: true })
                }
              })
            }
          }),
          pull.collect(cb)
        )
      }),
      pull.collect((err, networks) => {
        if (err) return callback(err)
        callback(null, networks.flat().filter(Boolean))
      })
    )
  }
}
