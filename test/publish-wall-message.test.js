const test = require('tape')
const Metadb = require('..')
const pull = require('pull-stream')
const tmpDir = require('tmp').dirSync

const message = 'never say never'
const swarmKey = 'testswarm'

test('publish a wall message', t => {
  const metadb = Metadb({ storage: tmpDir().name, test: true })
  metadb.ready((err) => {
    t.error(err, 'Ready does not throw err')
    metadb.buildIndexes(() => {
      metadb.swarm.connect(swarmKey, (err, swarms) => {
        t.error(err, 'does not throw err')
        metadb.publish.wallMessage(message, swarmKey, (err, seq) => {
          t.error(err, 'does not throw err on publish wall message')
          metadb.core.ready(() => {
            pull(
              metadb.core.api.wallMessages.pullBySwarmKey(swarmKey),
              pull.collect((err, messages) => {
                t.error(err, 'does not throw err')
                t.equals(messages.length, 1, 'the message exists')
                t.equals(messages[0].message, message, 'the message was correctly decrypted')
                metadb.swarm.disconnect(swarmKey, (err) => {
                  t.error(err, 'does not throw err on disconnect')
                  metadb.swarm.destroy(t.end)
                })
              })
            )
          })
        })
      })
    })
  })
})
