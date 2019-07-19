const { box } = require('kappa-box')

// TODO: optionally make a public request?
module.exports = function (core) {
  return function publishRequest (files, recipients, feedName, callback) {
    feedName = feedName || 'local'

    var requestMsg = {
      type: 'request',
      files
    }
    core.writer(feedName, (err, feed) => {
      aboutMsg.timestamp = Date.now()
      const boxedMsg = box(message, recipients)
      feed.append(boxedMsg, callback)
    })
  }
}
