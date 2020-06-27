const EventEmitter = require('events').EventEmitter
const pullLevel = require('pull-level')
const pull = require('pull-stream')
const { isInvite } = require('../schemas')

// The invites index (currently not used)

module.exports = function (level) {
  const events = new EventEmitter()
  let foundOne = false

  return {
    maxBatch: 100,

    map: function (msgs, next) {
      const ops = []
      var pending = 0
      msgs.forEach(function (msg) {
        if (!sanitize(msg)) return
        foundOne = true
        pending++
        delete msg.value.version
        delete msg.value.type
        // TODO dbkey
        const dbKey = msg.key + '@' + msg.seq
        level.get(dbKey, (err) => {
          if (err) {
            ops.push({
              type: 'put',
              key: msg.key + '@' + msg.seq,
              value: msg.value
            })
          }
          if (!--pending) done()
        })
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

    api: {
      get: function (core, keySeq, cb) {
        this.ready(() => {
          level.get(keySeq, cb)
        })
      },
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
      pullNotFromFeedId: function (core, feedId) {
        return core.api.invites.pull({
          // TODO
          gt: feedId,
          lt: feedId
        })
      },
      update: function (core, msgSeq, updateObject, cb) {
        level.get(msgSeq, (err, request) => {
          if (err) return cb(err)
          Object.assign(request, updateObject)
          level.put(msgSeq, request, (err) => {
            if (err) return cb(err)
            cb()
          })
        })
      },
      events: events
    }
  }
}

function sanitize (msg) {
  if (typeof msg !== 'object') return null
  if (typeof msg.value !== 'object') return null
  if (msg.value.type !== 'invite') return null
  if (!isInvite(msg.value)) return null
  return msg
}
