const pump = require('pump')
const hyperswarm = require('hyperswarm')
const Protocol = require('hypercore-protocol')
const auth = require('hypercore-peer-auth')
const debug = require('debug')('metadb')
const assert = require('assert')
const { keyedHash, GENERIC_HASH_BYTES } = require('./crypto')
const { isHexString } = require('./util')
const log = console.log

const CONTEXT = 'metadb'
const DEFAULT_TOPIC = 'mouse-p2p-app' // temp TODO

module.exports = function (metadb) {
  return function swarm (key, cb) {
    if (!key) return cb(null, new Error('No topic given'))
    if (key === '') key = DEFAULT_TOPIC
    metadb.connections[key] = _swarm(key)
    // console.log(Object.keys(metadb.connections))
    if (cb) cb(null, Object.keys(metadb.connections))
  }

  function _swarm (key) {
    key = keyToTopic(key)
    var swarm = hyperswarm({ validatepeer: (peer) => !log(peer) })
    swarm.join(key, { lookup: true, announce: true })
    log('Connected on ', key.toString('hex'), '  Listening for peers....')
    swarm.on('connection', (socket, details) => {
      // console.log('my metadb key ', metadb.keyHex)
      // console.log(swarm.connections)
      const isInitiator = !!details.client
      const protocol = new Protocol(isInitiator)
      pump(socket, protocol, socket)
      auth(protocol, {
        authKeyPair: metadb.keypair,
        onauthenticate (peerAuthKey, cb) {
          if (!metadb.connectedPeers.includes(peerAuthKey.toString('hex'))) metadb.connectedPeers.push(peerAuthKey.toString('hex'))

          // TODO: associate this key with host, so that we can record when they disconnect
          log('New peer connected with key ', peerAuthKey.toString('hex'))
          cb(null, true)
          socket.on('close', () => {
            log('Peer has disconnected ', peerAuthKey.toString('hex'))
            metadb.connectedPeers = metadb.connectedPeers.filter(p => p !== peerAuthKey.toString('hex'))
          })
        },
        onprotocol (protocol) {
          metadb.core.replicate(isInitiator, { live: true, stream: protocol })
        }
      })
      socket.on('error', log)
    })

    return swarm
  }
}

module.exports.unswarm = function (metadb) {
  return function unswarm (key, cb) {
    if (!key) return cb(null, new Error('No topic given'))
    if (key === '') key = DEFAULT_TOPIC
    if (metadb.connections[key]) {
      metadb.connections[key].leave(keyToTopic(key))
      metadb.connections[key].destroy()
      delete metadb.connections[key]
    }
    log('unswarmed', Object.keys(metadb.connections))
    if (cb) cb(null, Object.keys(metadb.connections))
  }
}

function keyToTopic (key) {
  //  key can be a string, which is hashed together with a unique string for
  // the app, and the hash used (to avoid bumping into people)
  if (typeof key === 'string') {
    key = (isHexString(key) && key.length === GENERIC_HASH_BYTES * 2)
      ? Buffer.from(key, 'hex')
      : keyedHash(key, CONTEXT)
  }
  assert(Buffer.isBuffer(key), 'Badly formatted key')
  return key
}
