module.exports = function (metaDb) {
  return function publishReply (key, recipient, callback) {
    if (!metaDb.localFeed) return callback(new Error('No local feed'))
    // TODO: use assert to validate
    // TODO: check if feed.key is already there
    // TODO: check if recipients are already strings
    const recipients = [recipient, metaDb.localFeed.key].map(r => r.toString('hex'))
    var msg = {
      type: 'reply',
      version: '1.0.0',
      key, // || 'file not available'
      timestamp: Date.now(),
      recipients
    }
    metaDb.localFeed.append(msg, callback)
  }
}
