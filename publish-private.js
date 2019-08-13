const { box } = require('kappa-box')

module.exports = function (core) {
  return function publishPrivate (message, recipients, feedName, callback) {
    feedName = feedName || 'local'

    core.writer(feedName, (err, feed) => {
      //  message.timestamp = Date.now()
      // TODO: check if feed.key is already there
      recipients.push(feed.key)
      const boxedMsg = box(message, recipients)
      feed.append(boxedMsg, callback)
    })
  }
}
