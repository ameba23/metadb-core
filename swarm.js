const discovery = require('discovery-swarm')
const pump = require('pump')
const config = require('dat-swarm-defaults')
const debug = require('debug')('metadb')
const assert = require('assert')
const { keyedHash } = require('./crypto')
const { isHexString } = require('./util')
const log = console.log

const CONTEXT = 'metadb'
const DEFAULT_TOPIC = 'mouse-p2p-app' // temp TODO

// TODO switch to hyperswarm

module.exports = function (metadb) {
  return function swarm (key) {
    //  key can be a string, which is hashed together with a unique string for
    // the app, and the hash used (to avoid bumping into people)
    key = key || DEFAULT_TOPIC
    if (typeof key === 'string') {
      key = (isHexString(key) && key.length === 64)
        ? Buffer.from(key, 'hex')
        : keyedHash(key, CONTEXT)
    }
    assert(Buffer.isBuffer(key), 'Badly formatted key')

    // add id property with local key?  (cabal does this)
    var swarm = discovery(config())

    swarm.join(key)
    log('Connected on ', key.toString('hex'), '  Listening for peers....')
    swarm.on('connection', (connection, peer) => {
      log('New peer connected with key ', peer.id.toString('hex'))
      // TODO: pump can also take a callback?
      pump(connection, metadb.core.replicate({ live: true }), connection)
    })
    return swarm
  }
}
