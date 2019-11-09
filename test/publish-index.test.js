const test = require('tape')
const MetaDb = require('..')
const pull = require('pull-stream')
const tmpDir = require('tmp').dirSync
const path = require('path')

const pathToIndex = path.join(path.resolve(__dirname), '../test-media')

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
            t.equal(files[0].sha256, 'c6f8621292d2b7f5c51827079a29bfe3fafa8b422719a27a18d3d2d7d722a256', 'donkey picture hashes match')
            t.equal(files[0].holders[0], metaDb.key.toString('hex'), 'holders has the correct key')
            t.equal(Object.values(metaDb.shares)[0], pathToIndex, 'path to index stored')
            t.end()
          })
        )
      })
    })
  })
})
