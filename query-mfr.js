const kappa = require('kappa-core')
const pull = require('pull-stream')
var core = kappa('./multimetadb', {valueEncoding: 'json'})
const level = require('level')
const View = require('./view-mfr')

const idx = level('./views')
const view = View(idx)
const pump = require('pump')

const discovery = require('discovery-swarm')

var swarm = discovery()

swarm.join('mouse-p2p-app')

core.use('query', view)

core.ready(() => {
  const $filter = { value: { filename: 'donkey.jpg' } }
  // const $filter = {}
  pull(
    core.api.query.read({ query: [{ $filter }] }),
    pull.drain(console.log)
  )
  swarm.on('connection', (connection, peer) => {
    console.log('new peer connected with key ', peer.id.toString('hex'))
    pump(connection, core.replicate({ live: true }), connection)
  })
})
