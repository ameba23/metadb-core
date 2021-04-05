const EventEmitter = require('events').EventEmitter
const confirmKey = require('confirm-key')
const { toString } = require('../util')

const FEED_ID_HEX_LENGTH = 32 * 2

// Peers index

module.exports = function (level) {
  const events = new EventEmitter()

  return {
    maxBatch: 100,

    map: function (msgs, next) {
      const ops = []
      async function processMsgs () {
        for await (const msg of msgs) {
          if (typeof msg.value !== 'object') continue
          if (!(msg.value.about || msg.value.header)) continue
          const newValue = msg.value.about
            ? { name: msg.value.about.name }
            : {}
          // TODO check timestamps to make sure we get newest?
          const existing = await level.get(msg.key).catch(() => {})
          if (existing && existing === newValue) continue
          ops.push({
            type: 'put',
            key: msg.key,
            value: newValue
          })
        }
      }

      processMsgs().then(() => {
        level.batch(ops, next)
      }).catch((err) => {
        throw err // TODO
      })
    },

    indexed: (msgs) => {
      events.emit('update', msgs)
    },

    api: {
      getName: async function (kappa, feedId) {
        const entry = await level.get(toString(feedId))
          .catch(() => {
            return { name: defaultName(feedId) }
          })
        return entry.name || defaultName(feedId)
      },
      feedIds: async function * () {
        for await (const key of level.createKeyStream()) {
          yield key
        }
      },
      names: async function * () {
        for await (const entry of level.createReadStream()) {
          yield {
            feedId: entry.key,
            name: entry.value.name || defaultName(entry.key)
          }
        }
      },
      events: events
    }
  }
}
function defaultName (feedId) {
  return confirmKey(Buffer.from(feedId, 'hex'), { wordlist: 'names.json' })
}
