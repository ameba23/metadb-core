const kappa = require('kappa-core')
const kv = require('kappa-view-kv')
var core = kappa('./multimetadb', {valueEncoding: 'json'})
var memdb = require('memdb')
// const level = require('subleveldown')
var idx = memdb()
// var idx = level('my-db', 'boop', {valueEncoding: 'binary'})

const pump = require('pump')

const discovery = require('discovery-swarm')

var swarm = discovery()

swarm.join('mouse-p2p-app')

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

core.use('kv', kvIdx)


core.ready(() => {
  core.api.kv.createReadStream().on('data', data => { 
    console.log(JSON.stringify(data, null, 4))
  })

  // core.api.kv.get('G_DSC_1288.jpg', function (err, values) {
  //         console.log('kv for "foo"', values)
  //       })  
  swarm.on('connection', (connection) => {
    console.log('new peer connected')
    pump(connection, core.replicate({ live: true }), connection)
  })
})


