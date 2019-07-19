const pull = require('pull-stream')

module.exports = function (core) {
  return function (query, opts = {}) {
    return pull(
      core.api.query.read(Object.assign(opts, { live: false, reverse: true, query }))
    )
  }
}
