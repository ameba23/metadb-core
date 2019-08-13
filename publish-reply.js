const { box } = require('kappa-box')

module.exports = function (core) {
  return function publishReply (key, recipient, feedName, callback) {
    feedName = feedName || 'local'

    var msg = {
      type: 'reply',
      key // || 'file not available'
    }
    core.writer(feedName, (err, feed) => {
      msg.timestamp = Date.now()
      const boxedMsg = box(msg, [ recipient ])
      feed.append(boxedMsg, callback)
    })
  }
}
