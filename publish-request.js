module.exports = function (metaDb) {
  return function publishRequest (files, recipients, callback) {
    if (!metaDb.localFeed) return callback(new Error('No local feed'))
    // TODO: validation
    // TODO: use dat-encode
    // TODO: check if feed.key is already there
    recipients.push(metaDb.localFeed.key)
    var msg = {
      type: 'request',
      version: '1.0.0',
      files,
      timestamp: Date.now(),
      recipients: recipients.map(recipient => recipient.toString('hex'))
    }
    metaDb.localFeed.append(msg, callback)
  }
}
