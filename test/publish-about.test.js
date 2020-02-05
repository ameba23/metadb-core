const test = require('tape')
const Metadb = require('..')
const pull = require('pull-stream')
const tmpDir = require('tmp').dirSync
// const { isAbout } = require('../schemas')

const name = 'alice'

test('publish an about message', t => {
  var metadb = Metadb({ storage: tmpDir().name })
  metadb.ready(() => {
    metadb.publish.about(name, (err, seq) => {
      t.error(err, 'does not throw err')
      metadb.buildIndexes(() => {
        pull(
          // metaDb.query.custom([{ $filter: { value: { type: 'about', name } } }]),
          metadb.core.api.peers.pullStream(),
          pull.collect((err, abouts) => {
            t.error(err, 'does not throw err')
            t.ok(abouts.length > 0, 'the about message exists')
            t.equal(abouts[0].name, 'alice', 'name correct')
            t.equal(abouts[0].feedId, metadb.key.toString('hex'), 'feedId correct')
            t.end()
            // metaDb.readMessages(() => {
              // console.log(metaDb.peerNames)
            // })
          })
        )
      })
    })
  })
})
