const test = require('tape')
const Metadb = require('..')
const tmpDir = require('tmp').dirSync
const path = require('path')
const pathToIndex = path.join(path.resolve(__dirname), './test-media')
const pull = require('pull-stream')

test('request and reply, 2 actors', t => {
  const giver = Metadb({ storage: tmpDir().name, test: true })
  const taker = Metadb({ storage: tmpDir().name, test: true })

  giver.ready(() => {
    giver.indexFiles(pathToIndex, {}, (err) => {
      t.error(err, 'no error on starting indexing')
    }, (err, result) => {
      t.error(err, 'no error on finishing indexing')
      t.true(result.metadataAdded > 0, 'metadata successfully added')
      giver.buildIndexes(() => {
        // TODO we should not need this extra call to ready
        giver.core.ready(() => {
          pull(
            giver.query.files(),
            pull.collect((err, files) => {
              t.error(err)
              t.ok(files.length, 'files present')
              taker.ready(() => {
                giver.swarm.connect('testswarm', (err, swarms) => {
                  t.error(err, 'No err on swarm')
                  taker.buildIndexes(() => {
                    taker.core._logs.on('feed', () => { console.log('found feed') })
                    taker.swarm.connect('testswarm', (err, swarms) => {
                      t.error(err, 'No err on swarm')
                      taker.core.ready(() => {
                        taker.request([files[0].sha256, files[1].sha256], (err) => {
                          t.error(err, 'No error on request')
                          setTimeout(t.end, 50000)
                        })
                      })
                    })
                  })
                })
              })
            })
          )
        })
      })

      // metadbs[0].unswarm('testswarm', (err, swarms) => {
      //   t.error(err, 'No error on first instance disconnecting')
      //   t.equals(swarms.length, 0, 'no connected swarms')
      //   metadbs[1].unswarm('testswarm', (err, swarms) => {
      //     t.error(err, 'No error on second instance disconnecting')
      //     t.equals(swarms.length, 0, 'no connected swarms')
      //     t.end()
      //   })
      // })
    })
  })
})
