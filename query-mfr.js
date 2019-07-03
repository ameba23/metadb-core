const kappa = require('kappa-core')
const pull = require('pull-stream')
const level = require('level')
const Query = require('kappa-view-query')
const pump = require('pump')
const discovery = require('discovery-swarm')

var core = kappa('./multimetadb', {valueEncoding: 'json'})
const db = level('./views')

// custom validator enabling you to write your own message schemas
const validator = function (msg) {
  if (typeof msg !== 'object') return null
  if (typeof msg.value !== 'object') return null
  if (typeof msg.value.id !== 'string') return null
  // if (typeof msg.value.type !== 'string') return null
  return msg
}

const indexes = [
  // indexes all messages from all feeds by timestamp 
  { key: 'log', value: ['value', 'timestamp'] },
  // indexes all messages from all feeds by message type, then by timestamp 
  { key: 'typ', value: [['value', 'type'], ['value', 'timestamp']] }
] 

core.use('query', Query(db, core, { indexes, validator })) 

var swarm = discovery()

swarm.join('mouse-p2p-app')

core.ready(() => {
  const query = [{ $filter: { value: { type: 'addFile', metadata: { track: 3 } } } }]
  // var feeds = core.feeds()
  // console.log('feeds', feeds)
  // const $filter = {}
  pull(
    core.api.query.read({ live: true, reverse: true, query }),
    pull.map(entry => {
      return entry.value
    }),
    pull.drain(console.log)
  )
  swarm.on('connection', (connection, peer) => {
    console.log('new peer connected with key ', peer.id.toString('hex'))
    pump(connection, core.replicate({ live: true }), connection)
  })
})
