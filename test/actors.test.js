const test = require('tape')
const MetaDb = require('..')
const pull = require('pull-stream')
const tmpDir = require('tmp').dirSync
const { isAbout } = require('../schemas')
const async = require('async')

const names = ['alice', 'bob']

test('publish an about message from 2 actors', t => {
  const metaDbs = []
  async.each(names, (name, callback) => {
    var metaDb = MetaDb({ path: tmpDir().name })
    metaDb.ready(() => {
      metaDb.publishAbout(name, (err, seq) => {
        t.error(err, 'does not throw err')
        metaDbs.push(metaDb)
        callback()
      })
    })
  }, (err) => {
    t.error(err, 'No error')
    replicate(metaDbs[0], metaDbs[1], (err) => {
      t.error(err, 'No error on replicate')
      metaDbs[0].buildIndexes(() => {
        pull(
          metaDbs[0].query([{ $filter: { value: { type: 'about' } } }]),
          pull.filter(message => isAbout(message.value)),
          pull.collect((err, abouts) => {
            t.error(err, 'does not throw err')
            t.ok(abouts.length > 0, 'the about message exists')
            metaDbs[0].readMessages(() => {
              console.log(metaDbs[0].peerNames)
              t.end()
            })
          })
        )
      })
    })
  })
})

function replicate (db1, db2, cb) {
  var s = db1.core.replicate({ live: false })
  var d = db2.core.replicate({ live: false })

  s.pipe(d).pipe(s)
  s.on('error', cb)
  s.on('end', cb)
}
