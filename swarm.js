const pump = require('pump')
const hyperswarm = require('hyperswarm')
const multiplex = require('multiplex')
const pull = require('pull-stream')
const assert = require('assert')

const crypto = require('./crypto')
const handshake = require('./handshake')
const FileTransfer = require('./file-transfer')

// const log = require('debug')('metadb')
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
      const plex = multiplex()
      plex.on('error', (err) => {
        log('Error from multiplex', err)
      })
      const indexStream = plex.createSharedStream('metadb')
      indexStream.on('error', console.log)

      const transferStream = plex.createSharedStream('file-transfer')
      transferStream.on('error', console.log)

      pump(socket, plex, socket)

      // Handshake gets remote pk and proves knowledge of swarm 'key'
      let remotePublicKey
      handshake(metadb.keypair, !isInitiator, transferStream, key, (err, remotePk, encryptionKeySplit) => {
        if (err) {
          log(err) // TODO also close the connection?
        } else {
          socket.cryptoParams = {
            remotePublicKey: remotePk.toString('hex'),
            encryptionKeySplit,
            indexStream,
            transferStream,
            isInitiator
          }
         remotePublicKey = remotePk
          // const deduplicated = details.deduplicate(metadb.keypair.publicKey, remotePk)
          log('To deduplicate:', metadb.keypair.publicKey.toString('hex'), remotePk.toString('hex'))
          // log('Deduplicated:', deduplicated, 'isinitiator:', !isInitiator)
          // if ((!deduplicated) && (!isInitiator)) {
          // if (!deduplicated) {
            // if dedup is false and we are initiator, they will be the one to drop a connection
            // if (weAreInitiator) we know this connection will live
            pump(indexStream, metadb.core.replicate(isInitiator, { live: true }), indexStream)

            metadb.connectedPeers[remotePk.toString('hex')] = isInitiator
               ? metadb.connectedPeers[remotePk.toString('hex')] || FileTransfer(metadb)(remotePk, transferStream, encryptionKeySplit)
               : FileTransfer(metadb)(remotePk, transferStream, encryptionKeySplit)

            metadb.emitWs({ connectedPeers: Object.keys(metadb.connectedPeers) })

            metadb.connectedPeers[remotePublicKey.toString('hex')].stream.on('close', () => {
               console.log('removing peer from list', swarm.connections.size)
              // delete metadb.connectedPeers[remotePublicKey.toString('hex')]
             //  metadb.emitWs({ connectedPeers: Object.keys(metadb.connectedPeers) })
            })
            metadb.connectedPeers[remotePublicKey.toString('hex')].stream.on('error', () => {
               console.log('transferstream error')
            })
          // }
        }
      })

      socket.on('error', (err) => {
        log('[swarm] Error from connection', err)
      })
    })

    // swarm.on('updated', ({ key }) => {
    //   console.log('swarm updated', swarm.connections.size)
    //   swarm.connections.forEach((connection) => {
    //     const { remotePublicKey, encryptionKeySplit, indexStream, transferStream, isInitiator } = connection.cryptoParams
    //     pump(indexStream, metadb.core.replicate(isInitiator, { live: true }), indexStream)
    //     metadb.connectedPeers[remotePublicKey] = FileTransfer(metadb)(Buffer.from(remotePublicKey, 'hex'), transferStream, encryptionKeySplit)
    //   })
    // })
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
  return crypto.keyedHash(key, CONTEXT)
}
