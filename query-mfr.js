const pull = require('pull-stream')
const level = require('level')
const Query = require('kappa-view-query')
const merge = require('deepmerge')
const path = require('path')

// custom validator enabling you to write your own message schemas
const validator = (msg) => {
  if (typeof msg !== 'object') return null
  if (typeof msg.value !== 'object') return null
  if (typeof msg.value.id !== 'string') return null
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
  return function queryMfr (query, callback) { // [opts] ?
    core.use('query', Query(db, core, { indexes, validator }))

    core.ready(() => {

      // console.log(core.api.query.explain({ live: false, reverse: true, query }))
      pull(
        core.api.query.read({ live: false, reverse: true, query }),
        pull.collect((err, entries) => {
          if (err) callback(err)
          callback(null, entries)
        })
      )
    })
  }
}

