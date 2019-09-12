const pull = require('pull-stream')
const { isRequest, isReply } = require('../schemas')

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
      request.value.files.map((file) => {
        // check we have it
        // look up the filename
        // look up the rest of the path using metaDb.shares[] - need helper fn
        // call createDat
        // if problems - reply with an error message
        // call publishReply
        // if all goes well, metaDb.repliedTo.push(reply.branch)
      })
    }
  }
}
