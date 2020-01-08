const pump = require('pump')
const hyperswarm = require('hyperswarm')
const Protocol = require('hypercore-protocol')
// const auth = require('hypercore-peer-auth')
const debug = require('debug')('metadb')
const assert = require('assert')
const { keyedHash } = require('./crypto')
const { isHexString } = require('./util')
const log = console.log

const CONTEXT = 'metadb'
const DEFAULT_TOPIC = 'mouse-p2p-app' // temp TODO
const HASH_LENGTH = 32 // TODO

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
    // add id property with local key?  (cabal does this)
    var swarm = hyperswarm()

    swarm.join(key, { lookup: true, announce: true })
    log('Connected on ', key.toString('hex'), '  Listening for peers....')

    swarm.on('connection', (socket, details) => {
      // const protocol = new Protocol(!!details.client)
      // pump(socket, protocol, socket)
      // auth(protocol, {
      //   authKeyPair = metadb.keyPair, //TODO
      //   onauthenticate (peerAuthKey, cb) {
      //     metadb.currentlyConntectedPeers.push(peerAuthKey)
      //     // TODO: associate this key with host, so that we can record when they disconnect
      //     log('New peer connected with key ')
      //   },
      //   onprotocol (protocol) {
      //     pump(socket, metadb.core.replicate(details.client, { live: true, stream: protocol }), socket)
      //   }
      // })
      pump(socket, metadb.core.replicate(details.client, { live: true }), socket)
    })

    swarm.on('disconnection', (socket, details) => {
      if (details.peer) {
        log(`disconnected from peer: ${details.peer.host}`)
      }
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
    console.log('unswarmed', Object.keys(metadb.connections))
    if (cb) cb(null, Object.keys(metadb.connections))
  }
}

function keyToTopic (key) {
  //  key can be a string, which is hashed together with a unique string for
  // the app, and the hash used (to avoid bumping into people)
  if (typeof key === 'string') {
    key = (isHexString(key) && key.length === HASH_LENGTH * 2)
      ? Buffer.from(key, 'hex')
      : keyedHash(key, CONTEXT)
  }
  assert(Buffer.isBuffer(key), 'Badly formatted key')
  return key
}
