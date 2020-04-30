const pump = require('pump')
const hyperswarm = require('hyperswarm')
// const Protocol = require('hypercore-protocol')
// const auth = require('hypercore-peer-auth')
const debug = require('debug')('metadb')
const assert = require('assert')
const { keyedHash, GENERIC_HASH_BYTES } = require('./crypto')
const { isHexString } = require('./util')
const crypto = require('./crypto')
const pull = require('pull-stream')
const log = console.log

const CONTEXT = 'metadb'
const DEFAULT_TOPIC = 'mouse-p2p-app' // temp TODO

module.exports = function (metadb) {
  const connect = function (key, cb) {
    // If no key given make a new 'private' swarm
    if (!key) key = crypto.randomBytes(32).toString('hex')
    if (Array.isArray(key)) return connectMultipleSwarms(key, cb)
    if (key === '') key = DEFAULT_TOPIC
    metadb.connections[key] = _swarm(key)
    metadb.knownSwarms = metadb.knownSwarms || new Set()
    metadb.swarmdb.put(key, true, (err) => {
      if (err) log('[swarm] Error writing key to db', err)
    })
    metadb.knownSwarms.add(key)
    if (cb) cb(null, Object.keys(metadb.connections))
  }
  return connect

  function _swarm (key) {
    const topic = keyToTopic(key)
    var swarm = hyperswarm({ validatepeer: (peer) => !log(peer) })
    swarm.join(topic, { lookup: true, announce: true })
    log('Connected to ', key.toString('hex'), '  Listening for peers....')
    swarm.on('connection', (socket, details) => {
      const isInitiator = !!details.client
      metadb.events.emit('ws', JSON.stringify({ connections: { addPeer: key.toString('hex') } }))
      // TODO handshake to prove knowledge of swarm 'key'
      const randomToken = crypto.randomBytes(32) // Used in handshake
      if (isInitiator) { // if *they* are the initiator
        socket.on('data', (data) => {
          const messageType = data.slice(0, 16).toString()
          if (messageType === 'metadb-handshake') {
            console.log('[non-initiator] handshaking...')
            socket.write(Buffer.concat([
              Buffer.from('handshake-capabi'),
              crypto.keyedHash(key, data.slice(16, 48)),
              randomToken
            ]))
          }
          if (messageType === 'handshake-capabi') {
            console.log('[non-initiator] recieved final message')
            if (!data.slice(16, 48).compare(keyedHash(key, randomToken))) {
              console.log('handshake complete!')
              pump(socket, metadb.core.replicate(isInitiator, { live: true }), socket)
            }
          }
        })
      } else {
        socket.on('data', (data) => {
          if (data.slice(0, 16).toString() === 'handshake-capabi') {
            console.log('[initiator] capability recieved...')
            // check it, if its valid, send one back
            const theirHash = data.slice(16, 48)
            if (!theirHash.compare(keyedHash(key, randomToken))) {
              console.log('[initiator] capability verified, sending one back...')
              socket.write(Buffer.concat([
                Buffer.from('handshake-capabi'),
                crypto.keyedHash(key, data.slice(48))
              ]))
              pump(socket, metadb.core.replicate(isInitiator, { live: true }), socket)
            } // TODO else drop connection
          }
        })
        socket.write(Buffer.concat([Buffer.from('metadb-handshake'), randomToken]))
      }

      // TODO peer authentication not working
      // const protocol = new Protocol(isInitiator)
      // pump(socket, protocol, socket)
      // auth(protocol, {
      //   authKeyPair: metadb.keypair,
      //   onauthenticate (peerAuthKey, cb) {
      //     if (!metadb.connectedPeers.includes(peerAuthKey.toString('hex'))) metadb.connectedPeers.push(peerAuthKey.toString('hex'))
      //
      //     log('New peer connected with key ', peerAuthKey.toString('hex'))
      //     cb(null, true)
      //     socket.on('close', () => {
      //       log('Peer has disconnected ', peerAuthKey.toString('hex'))
      //       metadb.connectedPeers = metadb.connectedPeers.filter(p => p !== peerAuthKey.toString('hex'))
      //     })
      //   },
      //   onprotocol (protocol) {
      //     // metadb.core.replicate(isInitiator, { live: true, stream: protocol })
      //     metadb.core.replicate(isInitiator, { live: true }).pipe(protocol)
      //
      //     // pump(protocol, metadb.core.replicate(isInitiator, { live: true }), protocol)
      //   }
      // })
      //
      socket.on('error', (err) => {
        log('[swarm] Error from connection', err)
      })
      socket.on('close', () => {
        metadb.events.emit('ws', JSON.stringify({ connections: { removePeer: key.toString('hex') } }))
      })
    })

    return swarm
  }

  function connectMultipleSwarms (keys, callback) {
    pull(
      pull.values(keys),
      pull.asyncMap(connect),
      pull.collect((err, swarms) => {
        if (err) return callback(err)
        callback(null, swarms.slice(-1)[0])
      })
    )
  }
}

module.exports.unswarm = function (metadb) {
  const unswarm = function (key, cb) {
    // if no swarm specified, disconnect from everything
    if (!key) key = Object.keys(metadb.connections)
    if (Array.isArray(key)) return disconnectMultipleSwarms(key, cb)
    if (key === '') key = DEFAULT_TOPIC
    if (metadb.connections[key]) {
      metadb.connections[key].leave(keyToTopic(key))
      metadb.connections[key].destroy()
      delete metadb.connections[key]
    }
    metadb.swarmdb.put(key, false, (err) => {
      if (err) log('[swarm] Error writing key to db', err)
    })
    log(`[swarm] Unswarmed from ${key}. Active connections are now: ${Object.keys(metadb.connections)}`)
    if (cb) cb(null, Object.keys(metadb.connections))
  }
  return unswarm

  function disconnectMultipleSwarms (keys, callback) {
    pull(
      pull.values(keys),
      pull.asyncMap(unswarm),
      pull.collect((err, swarms) => {
        if (err) return callback(err)
        callback(null, swarms.slice(-1)[0])
      })
    )
  }
}

module.exports.loadSwarms = function (metadb) {
  return function (callback) {
    metadb.knownSwarms = metadb.knownSwarms || new Set()
    const swarmStream = metadb.swarmdb.createReadStream()
    swarmStream.on('data', function (entry) {
      metadb.knownSwarms.add(entry.key)
      console.log('entry', entry)
      if (entry.value) {
        metadb.swarm(entry.key, (err) => {
          if (err) return callback(err)
        })
      }
    })
    swarmStream.once('end', callback)
    swarmStream.once('error', callback)
  }
}

function keyToTopic (key) {
  //  key can be a string, which is hashed together with
  //  a unique 'context' string.
  if (typeof key === 'string') key = Buffer.from(key)
  assert(Buffer.isBuffer(key), 'Badly formatted key')
  return keyedHash(key, CONTEXT)
}
