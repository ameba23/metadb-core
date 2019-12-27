const EventEmitter = require('events').EventEmitter
const merge = require('deepmerge')
const pullLevel = require('pull-level')
const pull = require('pull-stream')
const { isAddFile } = require('../schemas')

const HASH = 'h!'
const PATH = 'p!'
const HOLDER = 'o!'

module.exports = function (level) {
  const events = new EventEmitter()
  return {
    maxBatch: 100,

    map: function (msgs, next) {
      const ops = []
      // const seen = {}
      var pending = 0
      msgs.forEach(function (msg) {
        if (!sanitize(msg)) return
        pending++
        delete msg.value.type
        delete msg.value.version
        let merged = msg.value
        level.get(HASH + msg.value.sha256, function (err, existingValue) {
          if (!(err && err.notFound)) {
            merged = merge(existingValue, msg.value) // TODO: this will clobber old values
          }

          merged.holders = merged.holders || []
          if (!merged.holders.includes(msg.key)) merged.holders.push(msg.key)

          ops.push({
            type: 'put',
            key: HASH + msg.value.sha256,
            value: merged
          })

          ops.push({
            type: 'put',
            key: PATH + msg.value.filename + '!' + msg.value.timestamp,
            value: msg.value.sha256
          })

          ops.push({
            type: 'put',
            key: HOLDER + msg.key + '@' + msg.seq,
            value: msg.value.sha256
          })

          if (!--pending) done()
        })
      })
      if (!pending) done()

      function done () {
        level.batch(ops, next)
      }
    },

    indexed: (msgs) => {
      msgs
        .filter(msg => Boolean(sanitize(msg)))
        .forEach((msg) => {
          events.emit('update', msg)
        })
    },

    api: {
      get: function (core, sha256, cb) {
        this.ready(() => {
          level.get(HASH + sha256, cb)
        })
      },
      pathToHash: (core, filePath, cb) => {
        const res = []
        const stream = level.createReadStream({
          gt: PATH + filePath + '!!',
          lt: PATH + filePath + '!~'
        })
        stream.on('data', function (row) {
          if (row.key.split('!')[0] === filePath) res.push(row.value)
        })
        stream.once('end', () => cb(null, res))
        stream.once('error', cb)
      },
      pullStream: (core, opts) => {
        return pull(
          pullLevel.read(level, Object.assign({
            keys: false,
            gte: HASH,
            lte: HASH + '~'
          }, opts)) // {live: true}
        )
      },
      pullStreamByPath: function (core, opts = {}) {
        opts.subdir = opts.subdir || ''
        const subOpts = {
          keys: false,
          gte: PATH + opts.subdir,
          lte: PATH + opts.subdir + '~'
          // lte: String.fromCharCode(key.charCodeAt(0) + 1)
        }
        delete opts.subdir
        // this.ready(() => {
        // return cb(null, pull(
        return pull(
          pullLevel.read(level, Object.assign(subOpts, opts)),
          pull.asyncMap((hash, cb) => {
            core.api.files.get(hash, cb)
          })
        )
      },
      pullStreamByHolder: function (core, opts = {}) {
        opts.holder = opts.holder || ''
        const subOpts = {
          keys: false,
          gte: HOLDER + opts.holder,
          lte: HOLDER + opts.holder + '~'
        }
        delete opts.holder
        return pull(
          pullLevel.read(level, Object.assign(subOpts, opts)),
          pull.asyncMap((hash, cb) => {
            core.api.files.get(hash, cb)
          })
        )
      },
      count: function (core, opts = {}, cb) {
        let files = 0
        const peerFiles = {}
        pull(
          core.api.files.pullStream(opts),
          pull.drain((file) => {
            files++
            file.holders.forEach((peer) => {
              peerFiles[peer] = peerFiles[peer] || 0
              peerFiles[peer]++
            })
            return true
          }, (err) => {
            cb(err, {
              files,
              peerFiles
            })
          })
        )
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
