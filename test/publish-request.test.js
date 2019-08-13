const test = require('tape')
const metadb = require('..')
const pull = require('pull-stream')

const files = [ 'xvhiEpLSt/XFGCcHmim/4/r6i0InGaJ6GNPS19ciolY=.sha256' ]
const recipients = []

test('publish a request message', t => {
  metadb.publishRequest(files, recipients, null, (err, seq) => {
    t.notOk(err, 'does not throw err')
    metadb.queryMfr(() => {
      pull(
        metadb.query([{ $filter: { value: { type: 'request' } } }]),
        // metadb.query(),
        pull.collect((err, requests) => {
          // todo: isabout()

          console.log(requests)
          t.ok(requests.length > 0, 'the request message exists')
          t.end()
        })
      )
    })
  })
})
