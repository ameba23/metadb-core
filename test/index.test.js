const Metadb = require('..')
const { describe } = require('tape-plus')
const path = require('path')
const { tmpdir } = require('os')
const mkdirp = require('mkdirp').sync
const rimraf = require('rimraf')
const { randomBytes } = require('crypto')

function testDirectory () {
  const testDirectory = path.join(tmpdir(), randomBytes(4).toString('hex'))
  mkdirp(testDirectory)
  return testDirectory
}

describe('basic', (context) => {
  let requesterStorage
  let responderStorage

  context.beforeEach(assert => {
    requesterStorage = testDirectory()
    responderStorage = testDirectory()
  })

  context.afterEach(assert => {
    rimraf.sync(requesterStorage)
    rimraf.sync(responderStorage)
  })

  context('kappa works', async (assert) => {
    const requester = new Metadb({ storage: requesterStorage, dontConnect: true })
    await requester.ready()

    await requester.append('addFile', {
      sha256: Buffer.alloc(32),
      filename: 'file.txt',
      size: 500,
      metadata: JSON.stringify({ good: true })
    })

    await requester.views.ready()

    const entries = []
    for await (const entry of requester.query.files.stream()) {
      entries.push(entry)
    }

    assert.equal(entries.length, 1, 'Message successfully indexed')
    assert.equal(entries[0].filename, 'file.txt')
  })

  context('transfer file', async (assert) => {
    const requester = new Metadb({ storage: requesterStorage })
    await requester.ready()
    const responder = new Metadb({ storage: responderStorage })
    await responder.ready()

    const pathToIndex = path.join(path.resolve(__dirname), './test-media')

    await responder.scanFiles.scanDir(pathToIndex, {})

    await requester.addFeed(responder.feed.key)
    requester.request(responder.feed.key, {
      file: { sha256: Buffer.from('843b5593e6e1f23daeefb66fa5e49ba7800f5a4b84c03c91fac7f18fb2a3663f', 'hex') }
    })
  })
})
