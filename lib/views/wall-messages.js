const EventEmitter = require('events').EventEmitter
const pullLevel = require('pull-level')
const pull = require('pull-stream')
const { MetadbMessage } = require('../messages')
const crypto = require('../crypto')

// The wall messages index (currently not used)

module.exports = function (level, swarms) {
  const events = new EventEmitter()
  let foundOne = false

  return {
    maxBatch: 100,

    map: function (msgs, next) {
      const ops = []
      let pending = 0
      msgs.forEach(function (msg) {
        if (!sanitize(msg)) return
        foundOne = true
        // try all known swarm keys sequentially
        let plain
        const swarmKey = Object.keys(swarms).find((k) => {
          plain = crypto.secretUnbox(msg.value.private.symmetric, k)
        })
        if (!swarmKey) return
        let decoded
        try {
          decoded = MetadbMessage.decode(plain)
        } catch (err) {
          return
        }
        if (!decoded.wallMessage) return
        pending++

        ops.push({
          type: 'put',
          key: swarmKey + decoded.timestamp + msg.key + '@' + msg.seq,
          value: decoded.wallMessage
        })
        if (!--pending) done()
      })
      if (!pending) done()

      function done () {
        level.batch(ops, next)
      }
    },

    indexed: (msgs) => {
      if (foundOne) {
        events.emit('update', msgs)
        foundOne = false
      }
    },

    api: { // TODO query by swarmkey
      pull: function (core, opts = {}) {
        return pull(
          pullLevel.read(level, opts), // {live: true}
          pull.map(kv => Object.assign(kv.value, { msgSeq: kv.key }))
        )
      },
      pullFromFeedId: function (core, feedId) {
        return core.api.invites.pull({
          gte: feedId,
          lte: feedId + '~'
        })
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
