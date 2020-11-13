const test = require('tape')
const Metadb = require('..')
const pull = require('pull-stream')
const tmpDir = require('tmp').dirSync
const path = require('path')

const pathToIndex = path.join(path.resolve(__dirname), './test-media')
const donkeyHash = '843b5593e6e1f23daeefb66fa5e49ba7800f5a4b84c03c91fac7f18fb2a3663f'

test('index a directory', t => {
  const metadb = Metadb({ storage: tmpDir().name, test: true })
  metadb.ready((err) => {
    t.error(err, 'No error on ready')
    metadb.indexFiles(pathToIndex, {}, (err) => {
      t.error(err, 'no error on starting indexing')
    }, (err) => {
      t.error(err, 'no error on finishing indexing')
      metadb.buildIndexes(() => {
        metadb.files.get(donkeyHash, (err, fileObj) => {
          t.error(err, 'no error on getting file by hash')
          t.equal(fileObj.sha256, donkeyHash, 'donkey picture hashes match')
          t.equal(fileObj.holders[0], metadb.key.toString('hex'), 'holders has the correct key')
        })

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

            metadb.publish.rmFiles(donkeyHash, (err) => {
              t.error(err, 'no error on publish rmFile message')

              metadb.buildIndexes(() => {
                pull(
                  metadb.core.api.files.pullStream(),
                  pull.collect((err, files) => {
                    t.error(err, 'no error')
                    // console.log(JSON.stringify(files, null, 4))
                    t.ok(files.find(file =>
                      file.sha256 === donkeyHash && !file.holders.length
                    ), 'Donkey picture now has 0 holders')
                    t.end()
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
