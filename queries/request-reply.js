const pull = require('pull-stream')
const { isRequest, isReply } = require('../schemas')
const OwnFilesFromHashes = require('./own-files-from-hashes')
const createDat = require('../create-dat')

module.exports = function (metaDb) {
  return function (callback) {
    const key = metaDb.key.toSring('hex')
    // replies *FROM* me:
    pull(
      metaDb.query([{ $filter: { key }, value: { type: 'reply' } }]),
      pull.filter(msg => isReply(msg.value)),
      pull.map(msg => msg.value.branch),
      pull.drain((reply) => {
        if (metaDb.repliedTo.indexOf(reply) < 0) metaDb.repliedTo.push(reply)
      }, checkRequests())
    )

    function checkRequests () {
      // requests *TO* me:
      pull(
        metaDb.query([{ $filter: { key: { $ne: key }, value: { type: 'request' } } }]),
        pull.filter(msg => isRequest(msg.value)),
        pull.filter((request) => {
          const branchString = `${request.key}@${request.seq}`
          return metaDb.repliedTo.indexOf(branchString) < 0
        }),
        pull.drain(processRequest, callback)
      )
    }

    function processRequest (request) {
      OwnFilesFromHashes(metaDb)(request.value.files, (err, filePaths) => {
        if (err || !filePaths.length) {
          // reply should contain an error message
        }
        createDat(filePaths, (err, datKey) => {
          const branch = `${request.key}@${request.seq}`
          metaDb.publishReply(key, request.key, branch, (err, seq) => {
            if (err) callback(err) // new error 'problem publishing?'
            metaDb.repliedTo.push(branch)
            callback()
          })
        })
      })
    }
  }
}
