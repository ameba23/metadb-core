const assert = require('assert')
const { isHexString, isBranchRef } = require('./util')
const FEED_KEY_LENGTH = 32

module.exports = function (metadb) {
  return function publishReply (link, recipient, branch, callback) {
    try {
      assert(metadb.localFeed, 'No local feed')
      assert(isHexString(recipient, FEED_KEY_LENGTH), 'Recipient key must be 32 byte hex encoded string')
      assert(isBranchRef(branch), 'branch must be a reference to a message')
    } catch (err) { return callback(err) }
    const recipients = [recipient, metadb.key].map(r => r.toString('hex'))
    var msg = {
      type: 'reply',
      version: '1.0.0',
      link, // || 'file not available'
      branch,
      timestamp: Date.now(),
      recipients
    }
    metadb.localFeed.append(msg, callback)
  }
}
