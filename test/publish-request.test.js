const test = require('tape')
const MetaDb = require('..')
const pull = require('pull-stream')
const tmpDir = require('tmp').dirSync
const { isRequest } = require('../schemas')

const files = ['xvhiEpLSt/XFGCcHmim/4/r6i0InGaJ6GNPS19ciolY=.sha256']

test('publish a request message', t => {
  var metaDb = MetaDb({ path: tmpDir().name })
  metaDb.ready(() => {
    // TODO add a file to the db with the requested hash, so we have a recp
    // otherwise this will fail
    metaDb.publish.request(files, (err, seq) => {
      t.notOk(err, 'does not throw err')
      metaDb.buildIndexes(() => {
        pull(
          metaDb.query.custom([{ $filter: { value: { type: 'request', files } } }]),
          pull.filter(message => isRequest(message.value)),
          pull.collect((err, requests) => {
            t.error(err, 'does not throw err')
            t.equal(requests.length, 1, 'The request message exists')
            t.end()
          })
        )
      })
    })
  })
})
