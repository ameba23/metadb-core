const pull = require('pull-stream')
const { download } = require('../transfer/hypercore-sendfile') // publishFiles

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
            if (!reply.closed) {
              download(reply.link, metadb.downloadPath, (err, network) => {
                if (err) return cb2(err)
                // metadb.pendingDownloads.push(network) // TODO somehow check its not already there
                cb2(null, network)
              })
            }
          }),
          pull.collect(cb)
        )
      }),
      pull.collect((err, networks) => {
        if (err) return callback(err)
        callback(null, networks.flat())
      })
    )
  }
}
