const discovery = require('discovery-swarm')
const pump = require('pump')
const config = require('dat-swarm-defaults')
const debug = require('debug')('metadb')
const { keyedHash } = require('./crypto')

module.exports = function (core) {
  return function swarm (key) {
    //  key can be a string, which is hashed together with a unique string for
    // the app, and the hash used (to avoid bumping into people)
    key = key || 'mouse-p2p-app' // temp
    if (typeof key === 'string') {
      key = keyedHash(key, 'metadb')
    }

    // add id property with local key?  (cabal does this)
    var swarm = discovery(config())

    swarm.join(key)
    console.log('Connected on ', key.toString('hex'), '  Listening for peers....')
    swarm.on('connection', (connection, peer) => {
      console.log('New peer connected with key ', peer.id.toString('hex'))
      // TODO: pump can also take a callback?
      pump(connection, core.replicate({ live: true }), connection)
    })
  }
}
