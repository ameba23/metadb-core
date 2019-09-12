const pull = require('pull-stream')
const { isAbout } = require('../schemas')

module.exports = function (metaDb) {
  return function (callback) { // opts?
    pull(
      metaDb.query([{ $filter: { value: { type: 'about' } } }]),
      pull.filter(msg => isAbout(msg.value)),
      pull.drain((about) => {
        // TODO compare timestamps?
        metaDb.peerNames[about.key] = about.value.name
      }, callback)
    )
  }
}
