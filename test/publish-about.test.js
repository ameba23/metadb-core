const test = require('tape')
const metadb = require('..')
const pull = require('pull-stream')

const name = 'alice'

test('publish an about message', t => {
  metadb.publishAbout(name, null, (err, seq) => {
    t.notOk(err, 'does not throw err')
    metadb.queryMfr(() => {
      pull(
        metadb.query([{ $filter: { value: { type: 'about', name } } }]),
        pull.collect((err, abouts) => {
          // todo: isabout()
          t.ok(abouts.length > 0, 'the about message exists')
          t.end()
        })
      )
    })
  })
})
