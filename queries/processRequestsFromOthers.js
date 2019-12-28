const pull = require('pull-stream')
const OwnFilesFromHashes = require('./own-files-from-hashes')
const { publish } = require('../transfer/dat') // publishFiles

module.exports = function (metadb) {
  return function (callback) {
    // requests *TO* me:
    pull(
      metadb.query.requestsFromOthers(),
      pull.filter((request) => {
        console.log('------------------------------REQUEST:', request)
        // TODO explicity check that we are included as a recipient?
        return request.replies
          ? request.replies.find(reply => reply.from === metadb.keyHex)
          : true
      }),
      pull.asyncMap(processRequest),
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
}
