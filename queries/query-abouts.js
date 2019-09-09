const pull = require('pull-stream')
const validator = require('is-my-json-valid')

const isAbout = validator({
  $schema: 'http://json-schema.org/schema#',
  type: 'object',
  required: [type, version, timestamp, name],
  properties: {
    type: {
      type: 'string',
      pattern: '^about$',
    },
    version: {
      type: 'string'
    },
    timestamp: {
      type: 'number'
    }
  }
})



module.exports = function (metaDb) {
  return function (callback) { // opts?
    pull(
      metaDb.query([{ $filter: { value: { type: 'about' } } }]),
      pull.through((about) => {
        // TODO compare timestamps?
        metaDb.peerNames[about.key] = about.value.name
      }, callback)
    )
  }
}
