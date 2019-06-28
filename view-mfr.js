const MFR = require('map-filter-reduce')
const toPull = require('stream-to-pull-stream')
const defer = require('pull-defer')
const pull = require('pull-stream')

module.exports = function View (db, opts = {}) {
  return {
    maxBatch: opts.maxBatch || 100,

    map: function (msgs, next) {
      const ops = []
      var pending = 0

      msgs.forEach((msg) => {
        if (!sanitize(msg)) return

        // sort by id (hash)
        if (msg.value && msg.value.id) {
          const key = msg.value.id

          pending++
          db.get(key, function (err) {
            if (err && err.notFound) {
              ops.push({
                type: 'put',
                key,
                value: [msg.key, '@', msg.seq].join('')
              })
            }
            if (!--pending) done()
          })
        }
      })

      if (!pending) done()

      function done () {
        db.batch(ops, next)
      }
    },
    api: {
      read: function (core, opts) {
        var source = defer.source()
        var query = opts.query || {}

        core.ready(function () {
          source.resolve(toPull(db.createReadStream(opts)))
        })

        return pull(
          source,
          pull.asyncMap((msg, next) => {
            var id = msg.value
            var feed = core._logs.feed(id.split('@')[0])
            var seq = Number(id.split('@')[1])
            feed.get(seq, function (err, value) {
              if (err) return next(err)
              next(null, {
                key: feed.key.toString('hex'),
                seq,
                value
              })
            })
          }),
          MFR(query)
        )
      }
    }
  }

  function sanitize (msg) {
    if (typeof msg !== 'object') return null
    if (typeof msg.value !== 'object') return null
    if (typeof msg.value.id !== 'string') return null
    return msg
  }
}
