const Metadb = require('..')
const { describe } = require('tape-plus')
const path = require('path')
const { TestDir, iteratorToArray } = require('./util')

const donkeyHash = '843b5593e6e1f23daeefb66fa5e49ba7800f5a4b84c03c91fac7f18fb2a3663f'

describe('basic', (context) => {
  let requesterStorage
  let responderStorage

  context.beforeEach(assert => {
    requesterStorage = new TestDir()
    responderStorage = new TestDir()
  })

  context.afterEach(assert => {
    requesterStorage.delete()
    responderStorage.delete()
  })

  context('kappa works', async (assert) => {
    const requester = new Metadb({ storage: requesterStorage.name, test: true })
    await requester.ready()

    await requester.append('addFile', {
      sha256: Buffer.alloc(32),
      filename: 'file.txt',
      size: 500,
      metadata: JSON.stringify({ good: true })
    })

    await requester.views.ready()

    const entries = await iteratorToArray(requester.query.files.stream())
    console.log(requester.views.kappa.flows.files.source)
    assert.equal(entries.length, 1, 'Message successfully indexed')
    assert.equal(entries[0].filename, 'file.txt')
  })

  context('publish about message with name', async (assert) => {
    const requester = new Metadb({ storage: requesterStorage.name, test: true })
    await requester.ready()

    await requester.about('george')

    await requester.views.ready()

    // const names = await iteratorToArray(requester.query.peers.names())
    const name = await requester.query.peers.getName(requester.keyHex)
    assert.equal(name, 'george', 'name correctly retrieved')
  })

  context('transfer file', async (assert) => {
    const requester = new Metadb({ storage: requesterStorage.name, test: true })
    await requester.ready()
    await requester.connect()
    const responder = new Metadb({ storage: responderStorage.name, test: true })
    await responder.ready()
    await responder.connect()

    const pathToIndex = path.join(path.resolve(__dirname), './test-media')

    await responder.shares.scanDir(pathToIndex, {})

    await responder.views.ready()

    await requester.addFeed(responder.feed.key)
    await new Promise((resolve) => {
      requester.on('added', resolve)
    })
    await requester.views.ready()

    await requester.client.request(donkeyHash)

    const downloaded = await new Promise((resolve) => {
      requester.client.on('downloaded', resolve)
    })

    assert.equal(downloaded.sha256, donkeyHash, 'file downloaded')
    assert.true(downloaded.verified, 'file verified')
    assert.equal(downloaded.peer, responder.keyHex, 'correct peer key')

    const downloads = await iteratorToArray(requester.client.getDownloads())
    assert.equal(downloads[0].peer, responder.keyHex, 'download recorded')

    const uploads = await iteratorToArray(responder.server.getUploads())
    assert.equal(uploads[0].to, requester.keyHex, 'upload recorded')

    await responder.stop()
    await requester.stop()
  })

  context('transfer file - from wishlist', async (assert) => {
    const requester = new Metadb({ storage: requesterStorage.name, test: true })
    await requester.ready()
    await requester.connect()

    const responder = new Metadb({ storage: responderStorage.name, test: true })
    await responder.ready()
    await responder.connect()

    const pathToIndex = path.join(path.resolve(__dirname), './test-media')

    await responder.shares.scanDir(pathToIndex, {})

    await responder.views.ready()

    await requester.addFeed(responder.feed.key)
    await new Promise((resolve) => {
      requester.on('added', resolve)
    })
    await requester.views.ready()

    // TODO assert that we have the metadata for the file we want

    // Now the responder disconnects
    await responder.stop()
    // We make the request whilst they are away
    await requester.client.request(donkeyHash)

    requester.client.on('downloaded', onDownloaded)

    const newResponder = new Metadb({ storage: responderStorage.name, test: true })
    await newResponder.ready()
    await newResponder.connect()

    async function onDownloaded (downloaded) {
      assert.equal(downloaded.sha256, donkeyHash, 'file downloaded')
      assert.true(downloaded.verified, 'file verified')
      assert.equal(downloaded.peer, newResponder.keyHex, 'correct peer key')

      const downloads = await iteratorToArray(requester.client.getDownloads())
      assert.equal(downloads[0].peer, newResponder.keyHex, 'download recorded')

      const uploads = await iteratorToArray(newResponder.server.getUploads())
      assert.equal(uploads[0].to, requester.keyHex, 'upload recorded')

      await newResponder.stop()
      await requester.stop()
    }
  })
})
