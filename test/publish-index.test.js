const test = require('tape')
const MetaDb = require('..')
const pull = require('pull-stream')
const tmpDir = require('tmp').dirSync
const path = require('path')

const pathToIndex = path.join(path.resolve(__dirname), '../test-media')
const donkeyHash = '843b5593e6e1f23daeefb66fa5e49ba7800f5a4b84c03c91fac7f18fb2a3663f'

test('index a directory', t => {
  var metaDb = MetaDb({ path: tmpDir().name })
  metaDb.ready(() => {
    metaDb.indexFiles(pathToIndex, (err) => {
      t.error(err, 'does not throw err')
      metaDb.buildIndexes(() => {
        pull(
          metaDb.queryFiles(),
          // pull.filter(message => isAbout(message.value)),
          pull.collect((err, files) => {
            t.error(err, 'does not throw err')
            t.ok(files.length > 0, 'files exist')
            t.equal(files[0].sha256, donkeyHash, 'donkey picture hashes match')
            t.equal(files[0].holders[0], metaDb.key.toString('hex'), 'holders has the correct key')
            t.equal(Object.values(metaDb.config.shares)[0], pathToIndex, 'path to index stored')
            t.end()
          })
        )
      })
    })
  })
})
