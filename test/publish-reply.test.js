const test = require('tape')
const MetaDb = require('..')
const pull = require('pull-stream')
const tmpDir = require('tmp').dirSync
const { isReply } = require('../schemas')

const link = 'dat://fb17ae61d02cd97cb4a3f8b4ea6599afa152e361ff4aac6a27842effb2246126'
const recipient = Buffer.from('3c6c1fc2ac75cee8856df0c941cdcc0f0ae1337bcecaf6f89bd337ed1c2fecd7', 'hex')
const branch = recipient + '@5'

test('publish a reply message', t => {
  var metaDb = MetaDb({ path: tmpDir().name })
  metaDb.ready(() => {
    metaDb.publishReply(link, recipient, branch, (err, seq) => {
      t.notOk(err, 'does not throw err')
      metaDb.buildIndexes(() => {
        pull(
          metaDb.query.custom([{ $filter: { value: { type: 'reply', link } } }]),
          pull.filter(message => isReply(message.value)),
          pull.collect((err, replies) => {
            // todo: isabout()
            t.error(err, 'does not throw err')
            t.equal(replies.length, 1, 'The reply message exists')
            t.end()
          })
        )
      })
    })
  })
})
