const Metadb = require('..')
const { describe } = require('tape-plus')
const { TestDir, iteratorToArray } = require('./util')

describe('wall messages', (context) => {
  let storage

  context.beforeEach(assert => {
    storage = new TestDir()
  })

  context.afterEach(assert => {
    storage.delete()
  })

  context('post and retrieve a wall message', async (assert) => {
    const metadb = new Metadb({ storage: storage.name, test: true })
    await metadb.ready()
    metadb.swarm.join('boop')
    await metadb.wallMessage('hello', 'boop')
    await metadb.views.ready()
    const results = await iteratorToArray(metadb.query.wallMessages.all())
    assert.equals(results.length, 1, 'One message found')
    assert.equals(results[0].message, 'hello', 'Expected message decrypted')
    assert.equals(results[0].swarmKey, 'boop', 'Expected swarm name')
    assert.equals(results[0].author, metadb.keyHex, 'Expected author')
    assert.equals(typeof results[0].timestamp, 'number', 'Timestamp given')
    await metadb.swarm.close()
  })
})
