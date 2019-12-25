const test = require('tape')
const Metadb = require('..')
const pull = require('pull-stream')
const tmpDir = require('tmp').dirSync
const path = require('path')

const pathToIndex = path.join(path.resolve(__dirname), './test-media')
const donkeyHash = '843b5593e6e1f23daeefb66fa5e49ba7800f5a4b84c03c91fac7f18fb2a3663f'

test('index a directory', t => {
  var metadb = Metadb({ path: tmpDir().name })
  metadb.ready(() => {
    metadb.indexFiles(pathToIndex, (err) => {
      t.error(err, 'does not throw err')
      metadb.buildIndexes(() => {
        metadb.files.get(donkeyHash, (err, fileObj) => {
          t.error(err, 'no error on getting file by hash')
          t.equal(fileObj.sha256, donkeyHash, 'donkey picture hashes match')
          t.equal(fileObj.holders[0], metadb.key.toString('hex'), 'holders has the correct key')
          t.equal(Object.values(metadb.config.shares)[0], pathToIndex, 'path to index stored')

          metadb.files.getCounters((err, counters) => {
            t.error(err, 'no error on getCounters')
            console.log(JSON.stringify(counters, null,4)) // TODO

            pull(
              metadb.core.api.files.pullStream(),
              pull.collect((err, files) => {
                t.error(err, 'no error')
                t.ok(files.length > 1, 'multiple files indexed')
                // console.log(JSON.stringify(files, null, 4))
              })
            )

            pull(
              metadb.core.api.files.pullStreamByPath({ subdir: 'somedir/' }),
              pull.collect((err, files) => {
                t.error(err, 'no error on subdir search')
                t.equal(files.length, 1, 'subdir contains expected number of files')
                t.end()
              })
            )
          })
        })
      })
    })
  })
})
