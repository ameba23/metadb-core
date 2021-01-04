const EventEmitter = require('events').EventEmitter
const { toString } = require('../util')

// Peers index

module.exports = function (level) {
  const events = new EventEmitter()

  return {
    maxBatch: 100,

    map: function (msgs, next) {
      const ops = []
      msgs.forEach(function (msg) {
        if (!sanitize(msg)) return

        // TODO check timestamps to make sure we get newest?
        // TODO only push if its not already there
        ops.push({
          type: 'put',
          key: msg.key + '!name',
          value: msg.value.about.name || {}
        })
      })

      level.batch(ops, next)
    },

    indexed: (msgs) => {
      events.emit('update', msgs)
    },

    api: {
      getName: async function (kappa, feedId) {
        return level.get(toString(feedId) + '!name')
      },
      names: async function * () {
        for await (const entry of level.createReadStream()) {
          yield { feedId: entry.key.slice(0, 64), name: entry.value }
        }
      },
      events: events
    }
  }
}

function sanitize (msg) {
  if (typeof msg.value !== 'object') return null
  // if (msg.value.about || msg.value.header) return msg
  if (msg.value.about) return msg
  return null
}
