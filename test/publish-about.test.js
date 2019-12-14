const test = require('tape')
const MetaDb = require('..')
const pull = require('pull-stream')
const tmpDir = require('tmp').dirSync
const { isAbout } = require('../schemas')

const name = 'alice'

test('publish an about message', t => {
  var metaDb = MetaDb({ path: tmpDir().name })
  metaDb.ready(() => {
    metaDb.publishAbout(name, (err, seq) => {
      t.error(err, 'does not throw err')
      metaDb.buildIndexes(() => {
        pull(
          metaDb.query.custom([{ $filter: { value: { type: 'about', name } } }]),
          pull.filter(message => isAbout(message.value)),
          pull.collect((err, abouts) => {
            t.error(err, 'does not throw err')
            // todo: isabout()
            t.ok(abouts.length > 0, 'the about message exists')
            metaDb.readMessages(() => {
              console.log(metaDb.peerNames)
              t.end()
            })
          })
        )
      })
    })
  })
})
