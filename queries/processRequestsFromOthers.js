const pull = require('pull-stream')
const OwnFilesFromHashes = require('./own-files-from-hashes')
const { publish } = require('../transfer/tar-stream')

module.exports = function (metadb) {
  return function (callback) {
    // requests *TO* me:
    pull(
      metadb.query.requestsFromOthers(),
      pull.filter(request => {
        if (request.pendingDownloads && request.pendingDownloads.length) return true
        return !request.read
      }),
      pull.filter((request) => {
        // TODO explicity check that we are included as a recipient?
        return request.replies
          ? !request.replies.find(reply => reply.from === metadb.keyHex)
          : true
      }),
      pull.asyncMap(processRequest),
      pull.collect(callback)
    )

    function processRequest (request, cb) {
      console.log('------------------------------REQUEST:', request)
      metadb.requests.update(request.msgSeq, { read: true }, (err) => {
        if (err) return cb(err)
        OwnFilesFromHashes(metadb)(request.files, (err, fileObjects) => {
          if (err || !fileObjects.length) {
            // publish a reply with an error message?
            return cb() // err?
          }
          // const filenames = fileObjects.map(f => f.file)
          if (request.link) {
            publish(fileObjects, request.link, cb)
          } else {
            publish(fileObjects, (err, link, network) => {
              if (err) return cb(err) // also publish a sorry message?
              const branch = request.msgSeq
              const recipient = branch.split('@')[0]
              metadb.publish.reply(link, recipient, branch, (err, seq) => {
                if (err) return callback(err)
                console.log('reply published', seq, link)
                // metadb.repliedTo.push(branch)
                // update index?
                // metadb.activeDownloads.push(link)
                metadb.requests.update(request.msgSeq, { link }, (err) => {
                  if (err) return cb(err)
                  cb(null, network) // null, network
                })
              })
            })
          }
        })
      })
    }
  }
}
