const test = require('tape')
const Metadb = require('..')
const tmpDir = require('tmp').dirSync
const async = require('async')
const names = ['alice', 'bob']

test('connect to swarm', t => {
  const metadbs = []
  async.each(names, (name, callback) => {
    const metadb = Metadb({ storage: tmpDir().name, test: true })
    metadb.ready(() => {
      metadb.publish.about(name, (err, seq) => {
        t.error(err, 'does not throw err')
        metadb.buildIndexes(() => {
          metadb.swarm.connect('testswarm', (err, swarms) => {
            t.error(err, 'no error on connect to swarm')
            const numberSwarms = Object.keys(swarms).filter(s => swarms[s]).length
            t.equals(numberSwarms, 1, 'correct number of swarms')
            t.equals(Object.keys(swarms)[0], 'testswarm', 'correct swarm')
            metadbs.push(metadb)
            callback()
          })
        })
      })
    })
  }, (err) => {
    t.error(err, 'No error')
    // wait till we hear about another feed
    metadbs[0].core._logs.on('feed', () => {
      t.equals(metadbs[0].core.feeds().length, 2, 'we now have two feeds')
      metadbs[0].swarm.disconnect('testswarm', (err, swarms) => {
        t.error(err, 'No error on first instance disconnecting')
        const numberSwarms = Object.keys(swarms).filter(s => swarms[s]).length
        t.equals(numberSwarms, 0, 'no connected swarms')
        metadbs[1].swarm.disconnect('testswarm', (err, swarms) => {
          t.error(err, 'No error on second instance disconnecting')
          const numberSwarms = Object.keys(swarms).filter(s => swarms[s]).length
          t.equals(numberSwarms, 0, 'no connected swarms')
          t.end()
        })
      })
    })
  })
})
