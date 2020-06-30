const assert = require('assert')
const { uniq, isHexString } = require('../util')
const FEEDID_BYTES = 32 // TODO

module.exports = function (metadb) {
  return function publishInvite (recipients, link, callback) {
    try {
      assert(metadb.localFeed, 'No local feed')
      if (typeof recipients === 'string') recipients = [recipients]
      assert(Array.isArray(recipients), 'Recipients must be an array')
      recipients.forEach((recipient) => {
        assert(isHexString(recipient, FEEDID_BYTES), 'Recipients must be hex encoded feed ids')
      })
      // TODO validate link
      recipients.push(metadb.keyHex)
      recipients = uniq(recipients.flat())
      assert(!((recipients.length === 1) && (recipients[0] === metadb.keyHex)), 'Cannot invite yourself')

      assert(recipients.length <= 7, 'More than 7 recipients') // TODO publish multiple messages

      const msg = {
        link,
        recipients: recipients.map(recipient => recipient.toString('hex'))
      }
      // TODO check we didnt already publish a similar invite message
      metadb.publish.publishMessage(msg, 'invite', callback)
    } catch (err) { return callback(err) }
  }
}
