const Metadb = require('..')
const { describe } = require('tape-plus')
const path = require('path')
const TestDir = require('./test-dir')

describe('basic', (context) => {
  let storage

  context.beforeEach(assert => {
    storage = new TestDir()
  })

  context.afterEach(assert => {
    storage.delete()
  })

  context('index a directory', async (assert) => {
    const metadb = new Metadb({ storage: storage.name, dontConnect: true })
    await metadb.ready()

    const pathToIndex = path.join(path.resolve(__dirname), './test-media')
    const donkeyHash = '843b5593e6e1f23daeefb66fa5e49ba7800f5a4b84c03c91fac7f18fb2a3663f'

    await metadb.scanFiles.scanDir(pathToIndex, {})

    await metadb.views.ready()
    const donkey = await metadb.query.files.get(donkeyHash).catch((err) => {
      assert.error(err, 'no error on get')
    })
    assert.equal(donkey.sha256, donkeyHash, 'donkey picture hashes match')
    assert.equal(donkey.holders[0], metadb.keyHex, 'holders has the correct key')

    // TODO test rmFiles
  })
})
