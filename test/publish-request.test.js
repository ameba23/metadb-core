const test = require('tape')
const Metadb = require('..')
const pull = require('pull-stream')
const path = require('path')
const tmpDir = require('tmp').dirSync

const files = ['843b5593e6e1f23daeefb66fa5e49ba7800f5a4b84c03c91fac7f18fb2a3663f']
const pathToIndex = path.join(path.resolve(__dirname), './test-media')

test('publish a request message', t => {
  var metadb = Metadb({ storage: tmpDir().name })
  metadb.ready(() => {
    metadb.indexFiles(pathToIndex, (err) => {
      t.error(err, 'does not throw err')
      metadb.buildIndexes(() => {
        metadb.publish.request(files, (err, seq) => {
          t.notOk(err, 'does not throw err')
          metadb.buildIndexes(() => {
            pull(
              metadb.requests.pull(),
              pull.collect((err, requests) => {
                t.error(err, 'does not throw err')
                t.equal(requests.length, 1, 'The request message exists')
                console.log(requests[0])
                t.end()
              })
            )
          })
        })
      })
    })
  })
})
