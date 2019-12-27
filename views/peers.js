const EventEmitter = require('events').EventEmitter
const pullLevel = require('pull-level')
const pull = require('pull-stream')
const { isAbout } = require('../schemas')

module.exports = function (level) {
  const events = new EventEmitter()

  return {
    maxBatch: 100,

    map: function (msgs, next) {
      const ops = []
      var pending = 0
      msgs.forEach(function (msg) {
        if (!sanitize(msg)) return
        pending++
        // TODO check timestamps to make sure we get newest
        ops.push({
          type: 'put',
          key: msg.key + '!name',
          value: msg.value.name
        })
        if (!--pending) done()
      })
      if (!pending) done()

      function done () {
        level.batch(ops, next)
      }
    },

    // indexed: 
    //
    api: {
      getName: function (core, feedId, cb) {
        // this.ready(() => {})
        // TODO buffer to hex
        level.get(feedId + '!name', cb)
      },
      pullStream: () => {
        return pull(
          pullLevel.read(level), // {live: true}
          pull.map((kv) => {
            return { feedId: kv.key.slice(0, 64), name: kv.value }
          })
        )
      },
      events: events
    }
  }
}

function sanitize (msg) {
  if (typeof msg !== 'object') return null
  if (typeof msg.value !== 'object') return null
  if (msg.value.type !== 'about') return null
  if (!isAbout(msg.value)) return null
  return msg
}
