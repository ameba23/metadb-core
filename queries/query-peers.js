const pull = require('pull-stream')
const queryPeers = [
  { $filter: { value: { type: 'addFile' } } },
  { $reduce: {
    peerId: 'key',
    numberFiles: { $count: true }
  } }
]

module.exports = function (core) {
  return function () { // opts?
    return pull(
      core.api.query.read({ live: false, reverse: true, query: queryPeers })
    )
  }
}
