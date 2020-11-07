const test = require('tape')
const Metadb = require('..')
const pull = require('pull-stream')
const tmpDir = require('tmp').dirSync

const name = 'alice'

test('publish an about message', t => {
  const metadb = Metadb({ storage: tmpDir().name, test: true })
  metadb.ready((err) => {
    t.error(err, 'Ready does not throw err')
    metadb.publish.about(name, (err, seq) => {
      t.error(err, 'does not throw err')
      metadb.buildIndexes(() => {
        pull(
          metadb.core.api.peers.pullStream(),
          pull.collect((err, abouts) => {
            t.error(err, 'does not throw err')
            t.ok(abouts.length > 0, 'the about message exists')
            t.equal(abouts[0].name, 'alice', 'name correct')
            t.equal(abouts[0].feedId, metadb.key.toString('hex'), 'feedId correct')
            t.end()
          })
        )
      })
    })
  })
})
