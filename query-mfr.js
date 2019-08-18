module.exports = {
  validator: (msg) => {
    if (!msg) return null
    if (typeof msg !== 'object') return null
    if (typeof msg.value !== 'object') return null
    // if (typeof msg.value.id !== 'string') return null
    if (typeof msg.value.type !== 'string') return null
    return msg
  },
  indexes: [
    { key: 'ddd', value: ['value', 'id'] },
    // indexes all messages from all feeds by timestamp
    { key: 'log', value: ['value', 'timestamp'] },
    // indexes all messages from all feeds by message type, then by timestamp
    { key: 'typ', value: [['value', 'type'], ['value', 'timestamp']] }
  ]
}

const level = require('level')
const Query = require('kappa-view-query')
const path = require('path')
module.exports = function (metaDb) {
  // TODO: this should probably go in index.js
  const VIEW_PATH = path.join(metaDb.metaDbPath, '/views')
  const db = level(VIEW_PATH)

  // TODO: return should go after core.ready() ? (but then all commands would build the index)
  return function queryMfr (callback) {
    core.use('query', Query(db, core, { indexes, validator, map }))

    core.ready(() => {
      callback()
    })
  }
}
