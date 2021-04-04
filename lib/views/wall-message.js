const EventEmitter = require('events').EventEmitter
const { MetadbMessage } = require('../messages')
const crypto = require('../crypto')
const { nameToTopic } = require('../crypto')
const log = require('debug')('metadb-wall-messages-view')

// The wall messages index

const DECRYPTED = 'd!'
const TODECRYPT = 't!'

module.exports = function (level) {
  const events = new EventEmitter()
  let foundOne = false
  let swarmKeys = []
  return {
    maxBatch: 100,

    map: function (msgs, next) {
      const ops = []
      msgs.forEach(function (msg) {
        if (!sanitize(msg)) return
        foundOne = true
        // try all known swarm keys sequentially
        let plain
        const swarmKey = swarmKeys.find((k) => {
          plain = crypto.secretUnbox(msg.value.private.symmetric, nameToTopic(k))
          return plain
        })
        if (!swarmKey) {
          ops.push({
            type: 'put',
            key: TODECRYPT + msg.key + '@' + msg.seq,
            value: {}
          })
          return
        }
        let decoded
        try {
          decoded = MetadbMessage.decode(plain)
        } catch (err) {
          return log('Cannot decode message')
        }
        if (!decoded.wallMessage) return

        ops.push({
          type: 'put',
          key: DECRYPTED + swarmKey + '!' + decoded.timestamp + '!' + msg.key + '@' + msg.seq,
          value: decoded.wallMessage
        })
      })
      level.batch(ops, next)
    },

    indexed: (msgs) => {
      if (foundOne) {
        events.emit('update', msgs)
        foundOne = false
      }
    },

    api: {
      all: async function * (kappa, opts) {
        if (!opts) {
          opts = {
            gte: DECRYPTED,
            lte: DECRYPTED + '~'
          }
        }
        for await (const entry of level.createReadStream(opts)) {
          const properties = entry.key.split('!')
          const msgSeq = properties[3].split('@')
          yield Object.assign(entry.value, {
            swarmKey: properties[1],
            timestamp: properties[2],
            author: msgSeq[0],
            seq: msgSeq[1]
          })
        }
      },
      bySwarmKey: function (kappa, swarmKey) {
        return kappa.api.wallMessages.all({
          gte: DECRYPTED + swarmKey,
          lte: DECRYPTED + swarmKey + '~'
        })
      },
      updateSwarms: async function (kappa, updatedSwarms, getFeed) {
        swarmKeys = updatedSwarms
        for await (const entry of level.createReadStream({
          gte: TODECRYPT,
          lte: TODECRYPT + '~'
        })) {
          const feedSeq = entry.key.split('!')[1]
          const feed = getFeed(Buffer.from(feedSeq.split('@')[0], 'hex'))
          const message = await new Promise((resolve, reject) => {
            feed.get(Number(feedSeq.split('@')[1]), (err, value) => {
              if (err) return resolve()
              resolve(value)
            })
          })
          if (!message) continue
          let plain
          const swarmKey = swarmKeys.find((k) => {
            plain = crypto.secretUnbox(message.private.symmetric, keyToTopic(k))
            return plain
          })
          if (!swarmKey) continue

          let decoded
          try {
            decoded = MetadbMessage.decode(plain)
          } catch (err) {
            continue
          }
          if (!decoded.wallMessage) continue
          // log('decrypted!')
          await level.put(
            DECRYPTED + swarmKey + '!' + decoded.timestamp + '!' + feedSeq,
            decoded.wallMessage
          )
          await level.del(entry.key)
        }
      },
      events: events
    }
  }
}

function sanitize (msg) {
  if (typeof msg.value !== 'object') return null
  if (msg.value.private && msg.value.private.symmetric) return msg
  return null
}
