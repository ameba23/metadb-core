const pump = require('pump')
const hyperswarm = require('hyperswarm')
const multiplex = require('multiplex')
const pull = require('pull-stream')
const pullLevel = require('pull-level')
const assert = require('assert')

const crypto = require('./crypto')
const handshake = require('./handshake')
const FileTransfer = require('./file-transfer')
const log = require('debug')('metadb-swarm')

const CONTEXT = 'metadb' // Protocol name is hashed into the topic

module.exports = function (metadb) {
  class Swarm {
    constructor () {
      this.swarm = hyperswarm({ validatepeer: (peer) => !log(peer), multiplex: true })

      this.swarm.on('connection', (socket, details) => {
        const topics = details.peer
          ? [details.peer.topic]
          : Object.keys(metadb.swarms).filter(s => metadb.swarms[s]).map(keyToTopic)

        // details.on('topic', (topic) => {})
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
        handshake(metadb.keypair, !isInitiator, transferStream, topics, onPeer, (err, cryptoParams) => {
          if (err) {
            log(err) // TODO also close the connection?
          } else {
            transferStream.cryptoParams = cryptoParams
            const remotePk = cryptoParams.remotePk

            const deduplicated = details.deduplicate(metadb.keypair.publicKey, Buffer.from(remotePk, 'hex'))
            log('To deduplicate:', metadb.keypair.publicKey.toString('hex'), remotePk)
            log('Deduplicated:', deduplicated, 'isinitiator:', !isInitiator)

            if (!deduplicated) {
              // if dedup is false and we are initiator, they will be the one to drop a connection
              // if (weAreInitiator) we know this connection will live

              pump(indexStream, metadb.core.replicate(isInitiator, { live: true }), indexStream)

              if (metadb.connectedPeers[remotePk]) {
                metadb.connectedPeers[remotePk].addStream(transferStream)
              } else {
                metadb.connectedPeers[remotePk] = FileTransfer(metadb)(transferStream)
              }

              metadb.emitWs({ connectedPeers: Object.keys(metadb.connectedPeers) })

              transferStream.on('close', () => {
                log('Transfer stream closed')
                // delete metadb.connectedPeers[remotePublicKey.toString('hex')]
                //  metadb.emitWs({ connectedPeers: Object.keys(metadb.connectedPeers) })
              })
              transferStream.on('error', (err) => {
                log('transferstream error', err)
              })
            }
          }
        })

        socket.on('error', (err) => {
          log('[swarm] Error from connection', err)
        })
      })

      // This is where we can add block or allow lists
      function onPeer (remotePk, callback) {
        // Accept everybody
        return callback(null, true)
      }
    }

    connect (key, cb) {
      // If no key given make a new 'private' swarm
      if (!key) key = crypto.randomBytes(32).toString('hex')
      if (Array.isArray(key)) return this.connectMultipleSwarms(key, cb)
      metadb.swarms = metadb.swarms || {}
      metadb.swarms[key] = true

      const topic = keyToTopic(key)
      this.swarm.join(topic, { lookup: true, announce: true })

      log('Connected to ', key, '  Listening for peers....')
      log(`[swarm] Active connections are now: ${Object.keys(metadb.swarms).filter(s => metadb.swarms[s])}`)

      metadb.swarmdb.put(key, true, (err) => {
        if (err) log('[swarm] Error writing key to db', err)
      })
      if (cb) cb(null, metadb.swarms)
    }

    disconnect (key, cb) {
      log('Disconnecting from: ', key)
      const self = this
      // if no swarm specified, disconnect from everything
      if (!key) key = Object.keys(metadb.swarms).filter(s => metadb.swarms[s])
      if (Array.isArray(key)) return this.disconnectMultipleSwarms(key, cb)
      if (metadb.swarms[key]) {
        // leave takes a callback, but we dont wait for it here
        self.swarm.leave(keyToTopic(key), () => {
          log(`Swarm ${key} left.`)
        })
        metadb.swarms[key] = false
      }

      metadb.swarmdb.put(key, false, (err) => {
        if (err) log('[swarm] Error writing key to db', err)
      })

      log(`[swarm] Unswarmed from ${key}. Active connections are now: ${Object.keys(metadb.swarms).filter(s => metadb.swarms[s])}`)
      if (cb) cb(null, metadb.swarms)
    }

    connectMultipleSwarms (keys, callback) {
      pull(
        pull.values(keys),
        pull.asyncMap((key, cb) => {
          this.connect(key, cb)
        }),
        pull.collect((err, swarms) => {
          if (err) return callback(err)
          callback(null, swarms.slice(-1)[0])
        })
      )
    }

    disconnectMultipleSwarms (keys, callback) {
      pull(
        pull.values(keys),
        pull.asyncMap((key, cb) => {
          this.disconnect(key, cb)
        }),
        pull.collect((err, swarms) => {
          if (err) return callback(err)
          callback(null, swarms.slice(-1)[0])
        })
      )
    }

    loadSwarms (callback) {
      const self = this
      pull(
        pullLevel.read(metadb.swarmdb, { live: false }),
        pull.filter((entry) => {
          metadb.swarms[entry.key] = entry.value
          return entry.value
        }),
        pull.asyncMap((entry, cb) => {
          self.connect(entry.key, cb)
        }),
        pull.collect(callback)
      )
    }
  }
  return () => new Swarm()

  function keyToTopic (key) {
    //  key can be a string, which is hashed together with
    //  a unique 'context' string.
    if (typeof key === 'string') key = Buffer.from(key)
    assert(Buffer.isBuffer(key), 'Badly formatted key')
    return crypto.keyedHash(key, CONTEXT)
  }
}
