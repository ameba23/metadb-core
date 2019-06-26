const kappa = require('kappa-core')
const kv = require('kappa-view-kv')
var core = kappa('./multimetadb', {valueEncoding: 'json'})
var memdb = require('memdb')
var idx = memdb()
var pump = require('pump')

var discovery = require('discovery-swarm')

var swarm = discovery()

swarm.join('moose-p2p-app')
// create the key-value view
var kvIdx = kv(idx, function (msg, next) {
  if (!msg.value.id) return next()
  var ops = []
  var msgId = msg.key + '@' + msg.seq
  // key  : the 'key' part of the key-value store
  // id   : the identifier that the key maps to (the "FEED@SEQ" uniquely maps to this message)
  // links: a list of IDs ^ that this key replaces
  ops.push({ key: msg.value.id, id: msgId, links: msg.value.links || [] })

  next(null, ops)
})

// install key-value view into kappa-core under core.api.kv
core.use('kv', kvIdx)


core.ready(() => { 
  core.api.kv.createReadStream().on('data', data => { console.log(data) })
  
  swarm.on('connection', (connection) => {
    console.log('new peer connected')
    pump(connection, core.replicate({ live: true }), connection)
  })
})


