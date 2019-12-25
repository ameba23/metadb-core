const EventEmitter = require('events').EventEmitter
const pullLevel = require('pull-level')
const pull = require('pull-stream')
const { isRequest, isReply } = require('../schemas')

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
        delete msg.value.version
        if (msg.value.type === 'request') {
          delete msg.value.type
          ops.push({
            type: 'put',
            key: msg.key + '@' + msg.seq,
            value: msg.value
          })
        } else {
          level.get(msg.value.branch, (err, requestMsg) => {
            if (err) requestMsg = {}
            delete msg.value.type
            msg.value.from = msg.key
            requestMsg.replies = requestMsg.replies || []
            requestMsg.replies.push(msg.value)

            ops.push({
              type: 'put',
              key: msg.key + '@' + msg.seq,
              value: requestMsg
            })
          })
        }

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
      get: function (core, keySeq, cb) {
        this.ready(() => {
          level.get(keySeq, cb)
        })
      },
      pullStream: (core, opts = {}) => {
        return pull(
          pullLevel.read(level, opts), // {live: true}
          pull.map(kv => Object.assign(kv.value, { msgSeq: kv.key }))
        )
      },
      events: events
    }
  }
}

function sanitize (msg) {
  if (typeof msg !== 'object') return null
  if (typeof msg.value !== 'object') return null
  if (!['request', 'reply'].includes(msg.value.type)) return null
  if (!(isRequest(msg.value) || isReply(msg.value))) return null
  return msg
}
