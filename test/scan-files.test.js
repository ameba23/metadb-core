const Metadb = require('..')
const { describe } = require('tape-plus')
const path = require('path')
const { TestDir, iteratorToArray } = require('./util')

describe('basic', (context) => {
  let storage

  context.beforeEach(assert => {
    storage = new TestDir()
  })

  context.afterEach(assert => {
    storage.delete()
  })

  context('index a directory', async (assert) => {
    const metadb = new Metadb({ storage: storage.name, test: true })
    await metadb.ready()

    const pathToIndex = path.join(path.resolve(__dirname), './test-media')
    const donkeyHash = '843b5593e6e1f23daeefb66fa5e49ba7800f5a4b84c03c91fac7f18fb2a3663f'

    const totals = await metadb.shares.scanDir(pathToIndex, {})
    assert.equal(totals.filesParsed, totals.filesAdded, 'all files added')

    await metadb.views.ready()

    const donkey = await metadb.query.files.get(donkeyHash).catch((err) => {
      assert.error(err, 'no error on get')
    })
    assert.equal(donkey.sha256, donkeyHash, 'donkey picture hashes match')
    assert.equal(donkey.holders[0], metadb.keyHex, 'holders has the correct key')
    const { files } = await metadb.query.files.getTotals()
    assert.equal(files, 2, 'two files now in db')

    const oneLevel = await iteratorToArray(metadb.query.files.byPath({ oneLevel: true }))
    assert.ok(oneLevel.find(f => f.filename === 'donkey.jpg'), 'donkey.jpg exists')
    assert.ok(oneLevel.find(f => f.dir === 'someDir'), 'directory exists')

    const allFiles = await iteratorToArray(metadb.query.files.byPath())
    assert.equal(allFiles.length, totals.filesAdded, 'correct number of files')
    assert.ok(allFiles.find(f => f.filename === 'donkey.jpg'), 'donkey.jpg exists')

    const byHolders = await iteratorToArray(metadb.query.files.byHolders([metadb.keyHex]))
    assert.equal(byHolders.length, totals.filesAdded, 'correct number of files')
    assert.ok(byHolders.find(f => f.filename === 'donkey.jpg'), 'donkey.jpg exists')

    await metadb.append('rmFiles', { files: [Buffer.from(donkeyHash, 'hex')] })

    await metadb.views.ready()

    const donkeyRemoved = await metadb.query.files.get(donkeyHash).catch((err) => {
      assert.error(err, 'no error on get')
    })
    assert.equal(donkeyRemoved.holders.length, 0, 'donkey now has 0 holders')

    const afterRemove = await metadb.query.files.getTotals()
    assert.equal(afterRemove.files, 1, 'one file now in db')
  })
})
