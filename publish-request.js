const { box } = require('kappa-box')

// TODO: optionally make a public request?
module.exports = function (core) {
  return function publishRequest (files, recipients, feedName, callback) {
    feedName = feedName || 'local'

    var msg = {
      type: 'request',
      files
    }
    core.writer(feedName, (err, feed) => {
      msg.timestamp = Date.now()
      const boxedMsg = box(msg, recipients)
      feed.append(boxedMsg, callback)
    })
  }
}
