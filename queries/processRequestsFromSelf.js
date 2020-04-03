const pull = require('pull-stream')
const { download } = require('../transfer/tar-stream')
const crypto = require('../crypto')
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
            if (request.closed) return cb2()
            log('calling download on reply ', reply.link)
            const theirPublicKey = request.recipients.find(r => r !== metadb.keyHex)
            const encryptionKey = crypto.calculateAgreement(theirPublicKey, metadb.keypair, reply.link)
            download(reply.link, metadb.downloadPath, request.files, encryptionKey, onDownloaded, (err, network) => {
              if (err) return cb2(err)
              // metadb.pendingDownloads.push(network) // TODO somehow check its not already there
              cb2(null, network)
            })

            function onDownloaded (verifiedHashes, badHashes) {
              metadb.requests.update(request.msgSeq, { closed: true }, () => {})
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
