const test = require('tape')
const Metadb = require('..')
const pull = require('pull-stream')
const tmpDir = require('tmp').dirSync
const async = require('async')
const path = require('path')
const pathToIndex = {
  alice: path.join(path.resolve(__dirname), './test-media2'),
  bob: path.join(path.resolve(__dirname), './test-media')
}
const names = ['alice', 'bob']

test('request and reply, 2 actors', t => {
  const metadbs = []
  async.each(names, (name, callback) => {
    var metadb = Metadb({ path: tmpDir().name, test: true })
    metadb.ready(() => {
      metadb.publish.about(name, (err, seq) => {
        t.error(err, 'does not throw err')
        metadb.indexFiles(pathToIndex[name], (err) => {
          t.error(err, 'does not throw err')
          metadb.buildIndexes(() => {
            metadbs.push(metadb)
            callback()
          })
        })
      })
    })
  }, (err) => {
    t.error(err, 'No error')
    replicate(metadbs[0], metadbs[1], (err) => {
      t.error(err, 'No error on replicate')
      metadbs[0].buildIndexes(() => {
        pull(
          metadbs[0].core.api.peers.pullStream(),
          pull.collect((err, abouts) => {
            t.error(err, 'does not throw err')
            t.ok(abouts.length > 0, 'the about message exists')
            const files = ['843b5593e6e1f23daeefb66fa5e49ba7800f5a4b84c03c91fac7f18fb2a3663f']
            metadbs[0].publish.request(files, (err) => {
              t.error(err, 'no err on publishing request')
              replicate(metadbs[0], metadbs[1], (err) => {
                t.error(err, 'No error on replicate')
                pull(
                  metadbs[1].query.requestsFromOthers(),
                  pull.collect((err, requests) => {
                    t.error(err, 'requests queried without error')
                    t.equal(requests.length, 1, 'returns one element')
                    replicate(metadbs[0], metadbs[1], (err) => {
                      t.error(err, 'No error on replicate')
                      pull(
                        metadbs[0].query.requestsFromSelf(),
                        pull.collect((err, requests) => {
                          t.error(err, 'No error on query requests from self')
                          console.log(requests)
                          t.end()
                        })
                      )
                    })
                  })
                )
              })
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
