const pull = require('pull-stream')
const assert = require('assert')
const { uniq, isHexString } = require('../util')
const SHA256_BYTES = 32 // TODO
const VERSION = '1.0.0'

module.exports = function (metadb) {
  return function publishRequest (files, callback) {
    try {
      assert(metadb.localFeed, 'No local feed')
      if (typeof files === 'string') files = [files]
      assert(Array.isArray(files), 'Files must be an array')
      files.forEach((file) => {
        assert(isHexString(file, SHA256_BYTES), 'Files must be hex encoded hashes')
      })
    } catch (err) { return callback(err) }

    pull(
      pull.values(files),
      pull.asyncMap(metadb.files.get),
      pull.map(file => file.holders),
      pull.collect((err, recipients) => {
        if (err) return callback(err)
        recipients.push(metadb.keyHex)
        recipients = uniq(recipients.flat())
        if (recipients.length > 7) callback(new Error('More than 7 recipients')) // TODO publish multiple messages
        const msg = {
          type: 'request',
          version: VERSION,
          files,
          timestamp: Date.now(),
          recipients: recipients.map(recipient => recipient.toString('hex'))
        }
        // TODO check we didnt already publish a similar request message (files and recps)
        metadb.localFeed.append(msg, callback)
      })
    )
  }
}
