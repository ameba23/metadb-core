const EventEmitter = require('events').EventEmitter
const pullLevel = require('pull-level')
const pull = require('pull-stream')
const { MetadbMessage } = require('../messages')
const crypto = require('../crypto')
const { keyToTopic } = require('../swarm')
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
          plain = crypto.secretUnbox(msg.value.private.symmetric, keyToTopic(k))
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
      pull: function (core, opts = {}) {
        return pull(
          pullLevel.read(level, opts), // {live: true}
          pull.map((kv) => {
            const properties = kv.key.split('!')
            const msgSeq = properties[3].split('@')
            return Object.assign(kv.value, {
              swarmKey: properties[1],
              timestamp: properties[2],
              author: msgSeq[0],
              seq: msgSeq[1]
            })
          })
        )
      },
      pullBySwarmKey: function (core, swarmKey) {
        return core.api.wallMessages.pull({
          gte: DECRYPTED + swarmKey,
          lte: DECRYPTED + swarmKey + '~'
        })
      },
      updateSwarms: function (core, updatedSwarms, callback = () => {}) {
        swarmKeys = updatedSwarms
        pull(
          pullLevel.read(level, {
            gte: TODECRYPT,
            lte: TODECRYPT + '~'
          }),
          pull.asyncMap((entry, cb) => {
            const feedSeq = entry.key.split('!')[1]
            const feed = core._logs.feed(feedSeq.split('@')[0])
            feed.get(Number(feedSeq.split('@')[1]), (err, value) => {
              if (err) return cb(err)
              let plain
              const swarmKey = swarmKeys.find((k) => {
                plain = crypto.secretUnbox(value.private.symmetric, keyToTopic(k))
                return plain
              })
              if (!swarmKey) return cb()

              let decoded
              try {
                decoded = MetadbMessage.decode(plain)
              } catch (err) {
                return cb(err)
              }
              if (!decoded.wallMessage) return undefined
              // log('decrypted!')
              level.put(
                DECRYPTED + swarmKey + '!' + decoded.timestamp + '!' + feedSeq,
                decoded.wallMessage,
                (err) => {
                  if (err) return cb(err)
                  level.del(entry.key, cb)
                }
              )
            })
          }),
          pull.collect(callback)
        )
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
