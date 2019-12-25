const pull = require('pull-stream')

module.exports = function (metadb) {
  return function (callback) { // opts?
    pull(
      metadb.peers.pullStream(),
      pull.drain((about) => {
        metadb.peerNames[about.feedId] = about.name
      }, callback)
    )
  }
}
