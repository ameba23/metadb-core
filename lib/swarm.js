const hyperswarm = require('hyperswarm')
const { EventEmitter } = require('events')
const crypto = require('./crypto')
const log = require('debug')('metadb-swarm')

// Protocol name is hashed into the topic
const ZERO = Buffer.alloc(32)
const CONTEXT = crypto.genericHash(Buffer.from('metadb'), ZERO)

// Join/leave 'swarms'

module.exports = class Swarm extends EventEmitter {
  constructor (keypair, db) {
    super()
    this.swarm = hyperswarm({
      multiplex: true
    })
    this.topics = new Map()
    this.swarms = new Set()
    this.keypair = keypair
    this.db = db

    const self = this
    this.swarm.on('connection', (socket, details) => {
      log('Peer connected')

      const topic = details.peer ? details.peer.topic : undefined

      const isInitiator = !!details.client
      log('Topic', topic, isInitiator)

      if (isInitiator) {
        socket.write(self.announce(topic))
      } else {
        socket.on('data', (message) => {
          const thierKey = this.openAnnounce(message)
          log('Got key', thierKey)
          if (thierKey) self.emit('peer', thierKey)
          // TODO if (!thierKey) disconnect from them!?
        })
      }
    })
  }

  join (name) {
    const topic = this.nameToTopic(name)
    this.emit('swarm', name, 'joining')
    this.swarm.join(topic, { lookup: true, announce: true }, () => {
      log('Connected to ', name, '  Listening for peers....')
      this.emit('swarm', name, true)
    })
    this.swarms.add(name)
    this.db.put(name, true)
  }

  leave (name) {
    const topic = this.nameToTopic(name)
    log('Leaving ', name)
    this.emit('swarm', name, 'leaving')
    this.swarm.leave(topic, () => {
      this.emit('swarm', name, false)
    })
    this.db.put(name, false)
  }

  destroy (callback) {
    this.swarm.destroy(callback)
  }

  announce (topic) {
    const name = this.topics.get(topic)
    // if (!name) return undefined // TODO handle this case
    const message = Buffer.concat([
      this.keypair.publicKey,
      crypto.signDetached(name, this.keypair.secretKey)
    ])
    return crypto.secretBox(message, crypto.genericHash(name, ZERO))
  }

  openAnnounce (message) {
    let unboxed
    let name
    for (const nameToTry of this.topics.values()) {
      unboxed = crypto.secretUnbox(message, crypto.genericHash(nameToTry, ZERO))
      if (unboxed) {
        name = nameToTry
        break
      }
    }
    if (!unboxed) return false
    const publicKey = unboxed.slice(0, 32)
    const signature = unboxed.slice(32)
    if (!crypto.verify(signature, name, publicKey)) return false
    return publicKey
  }

  async loadPreviouslyConnected () {
    for await (const entry of this.db.createReadStream()) {
      this.swarms.add(entry.key)
      if (entry.value) this.join(entry.key)
    }
  }

  nameToTopic (name) {
    name = Buffer.from(name)
    const topic = crypto.genericHash(name, CONTEXT)
    this.topics.set(topic, name)
    return topic
  }
}
