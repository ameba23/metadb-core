const discovery = require('discovery-swarm')
const pump = require('pump')

module.exports = function (core) {
  return function swarm (key) {
    // TODO: use dat-swarm-defaults?
    // add id property with local key?  (cabal does this)
    var swarm = discovery()

    // TODO: change this
    key = key || 'mouse-p2p-app'
    swarm.join(key)
    console.log('Connected on ', key, '  Listening for peers....')
    swarm.on('connection', (connection, peer) => {
      console.log('New peer connected with key ', peer.id.toString('hex'))
      // TODO: pump can also take a callback?
      pump(connection, core.replicate({ live: true }), connection)
    })

    // callback(null, swarm) ?
  }
}
