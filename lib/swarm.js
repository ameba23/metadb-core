const hyperswarm = require('hyperswarm')
const { EventEmitter } = require('events')
const crypto = require('./crypto')
const { printKey } = require('./util')
const { nameToTopic } = require('./crypto')
const log = require('debug')('metadb-swarm')

// Join/leave 'swarms'

// Protocol name is hashed into the topic

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
      const topic = details.peer ? details.peer.topic : undefined
      const isInitiator = !!details.client

      log(`Peer connected to swarm topic: ${printKey(topic)} initiator: ${isInitiator}`)

      if (isInitiator) {
        socket.write(self.announce(topic))
      } else {
        socket.on('data', (message) => {
          const thierKey = self.openAnnounce(message)
          log(`Got remote peers key ${printKey(thierKey)}`)
          if (thierKey) self.emit('peer', thierKey)
          // TODO if (!thierKey) disconnect from them!?
        })
      }
    })
  }

  join (name) {
    if (name === '') {
      log('Attempting to join swarm with empty string as name, ignoring')
      return
    }
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
    if (name === '') {
      log('Attempting to leave swarm with empty string as name, ignoring')
      return
    }
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

  async close () {
    await new Promise((resolve, reject) => {
      this.destroy((err) => {
        if (err) return reject(err)
        resolve()
      })
    })
  }

  announce (topic) {
    const name = this.topics.get(topic)
    // if (!name) return undefined // TODO handle this case
    const message = Buffer.concat([
      this.keypair.publicKey,
      crypto.signDetached(name, this.keypair.secretKey)
    ])
    return crypto.secretBox(message, crypto.genericHash(name))
  }

  openAnnounce (message) {
    let unboxed
    let name
    for (const nameToTry of this.topics.values()) {
      unboxed = crypto.secretUnbox(message, crypto.genericHash(nameToTry))
      if (unboxed) {
        name = nameToTry
        break
      }
    }
    if (!unboxed) return false
    const publicKey = unboxed.slice(0, crypto.SIGN_PUBLIC_KEY_BYTES)
    const signature = unboxed.slice(crypto.SIGN_PUBLIC_KEY_BYTES)
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
    const topic = nameToTopic(name)
    this.topics.set(topic, Buffer.from(name))
    return topic
  }
}
