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
    }, (err) => {
      t.error(err, 'no error on finishing indexing')
      pull(
        giver.query.files(),
        pull.collect((err, files) => {
          t.error(err)
          taker.ready(() => {
            giver.buildIndexes(() => {
              giver.swarm('testswarm', (err, swarms) => {
                t.error(err, 'No err on swarm')
                taker.buildIndexes(() => {
                  taker.swarm('testswarm', (err, swarms) => {
                    t.error(err, 'No err on swarm')
                    // wait till we hear about another feed
                    taker.core._logs.on('feed', () => {
                      taker.publish.request([files[0].sha256, files[2].sha256], (err) => {
                        t.error(err, 'No error on request')
                        setTimeout(t.end, 50000)
                      })
                    })
                  })
                })
              })
            })
          })
        })
      )

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
