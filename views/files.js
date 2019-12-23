const EventEmitter = require('events').EventEmitter
const merge = require('deepmerge')
const pullLevel = require('pull-level')
const pull = require('pull-stream')
const { isAddFile } = require('../schemas')

module.exports = function (byHash, byPath) {
  const events = new EventEmitter()
  return {
    maxBatch: 100,

    map: function (msgs, next) {
      const opsByHash = []
      const opsByPath = []
      // const seen = {}
      var pending = 0
      msgs.forEach(function (msg) {
        if (!sanitize(msg)) return
        pending++
        delete msg.value.type
        msg.value.holders = [msg.key]
        let merged = msg.value
        byHash.get(msg.value.sha256, function (err, existingValue) {
          if (!(err && err.notFound)) {
            msg.value.holders = existingValue.holders
            if (!msg.value.holders.includes(msg.key)) msg.value.holders.push(msg.key)
            merged = merge(existingValue, msg.value) // TODO: this will clobber old values
          }

          opsByHash.push({
            type: 'put',
            key: msg.value.sha256,
            value: merged
          })

          opsByPath.push({
            type: 'put',
            key: msg.value.filename + '!' + msg.value.timestamp,
            value: msg.value.sha256
          })

          if (!--pending) done()
        })
      })
      if (!pending) done()

      function done () {
        byHash.batch(opsByHash, (err) => {
          if (err) return next(err)
          byPath.batch(opsByPath, next)
        })
      }
    },

    indexed: (msgs) => {
      msgs
        .filter(msg => Boolean(sanitize(msg)))
        .forEach((msg) => {
          events.emit('file', msg)
        })
    },

    api: {
      getByHash: function boop (core, sha256, cb) {
        this.ready(() => {
        // TODO buffer to hex
          byHash.get(sha256, cb)
        })
      },
      pathToHash: (core, filePath, cb) => {
        const res = []
        const stream = byPath.createReadStream({
          gt: filePath + '!!',
          lt: filePath + '!~'
        })
        stream.on('data', function (row) {
          if (row.key.split('!')[0] === filePath) res.push(row.value)
        })
        stream.once('end', () => cb(null, res))
        stream.once('error', cb)
      },
      pullStream: () => {
        return pull(
          pullLevel.read(byHash, { keys: false }) // {live: true}
        )
      },
      pullStreamByPath: function (core, opts = {}) {
        if (opts.subdir) {
          opts = {
            gte: opts.subdir,
            lte: opts.subdir + '~'
            // lte: String.fromCharCode(key.charCodeAt(0) + 1)
          }
        }
        // this.ready(() => {
        // return cb(null, pull(
        return pull(
          pullLevel.read(byPath, Object.assign({ keys: false }, opts)),
          pull.asyncMap((hash, cb) => {
            core.api.files.getByHash(hash, cb)
          })
        )
        // })
      },
      events: events
    }
  }
}

function sanitize (msg) {
  if (typeof msg !== 'object') return null
  if (typeof msg.value !== 'object') return null
  if (msg.value.type !== 'addFile') return null
  // if (!['addFile', 'fileComment'].includes(msg.value.type)) return null
  if (!isAddFile(msg.value)) return null
  // if (!(isAddFile(msg.value) || isFileComment(msg.value))) return null
  return msg
}
