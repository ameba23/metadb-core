const pull = require('pull-stream')
const level = require('level')
const Query = require('kappa-view-query')
const path = require('path')
const { isBoxedMessage, unbox, getSecretKey } = require('kappa-box')

// custom validator enabling you to write your own message schemas
const validator = (msg) => {
  if (!msg) return null
  if (typeof msg !== 'object') return null
  if (typeof msg.value !== 'object') return null
  // if (typeof msg.value.id !== 'string') return null
  if (typeof msg.value.type !== 'string') return null
  return msg
}


const indexes = [
  { key: 'ddd', value: ['value', 'id'] },
  // indexes all messages from all feeds by timestamp
  { key: 'log', value: ['value', 'timestamp'] },
  // indexes all messages from all feeds by message type, then by timestamp
  { key: 'typ', value: [['value', 'type'], ['value', 'timestamp']] }
]


module.exports = function (core, METADB_PATH) {
  // TODO: this should probably go in index.js
  const VIEW_PATH = path.join(METADB_PATH, '/views')
  const db = level(VIEW_PATH)

  // TODO: return should go after core.ready() ? (but then all commands would build the index)
  return function queryMfr (callback) {
    // TODO: this is a hack.  store the pk
    core.writer('local', (err, feed) => {
      const mykey = feed.key

      // TODO: specific path, cache secret key?
      getSecretKey(METADB_PATH, mykey, (err, secretKey) => {
        if (err) throw err
        const map = (msg) => {
          if (!isBoxedMessage(msg.value)) return msg
          const unboxed = unbox(msg.value, secretKey)
          // dont index messages which are not for us
          if (unboxed instanceof Error) return msg
          msg.value = unboxed
          return msg
        }
        core.use('query', Query(db, core, { indexes, validator, map }))

        core.ready(() => {
          callback()
        })
      })
    })
  }
}

