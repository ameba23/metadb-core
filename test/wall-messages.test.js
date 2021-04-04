const Metadb = require('..')
const { describe } = require('tape-plus')
const { TestDir, iteratorToArray } = require('./util')

describe('basic', (context) => {
  let storage

  context.beforeEach(assert => {
    storage = new TestDir()
  })

  context.afterEach(assert => {
    storage.delete()
  })

  context('post a wall message', async (assert) => {
    const metadb = new Metadb({ storage: storage.name })
    await metadb.ready()
    metadb.swarm.join('boop')
    await metadb.wallMessage('hello', 'boop')
    await metadb.views.ready()
    const results = await iteratorToArray(metadb.query.wallMessages.all())
console.log('resolg', results)
    await metadb.swarm.close()
  })
})
