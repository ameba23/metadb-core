const EventEmitter = require('events').EventEmitter
const merge = require('deepmerge')
const pullLevel = require('pull-level')
const pull = require('pull-stream')
const { sep } = require('path')
const { uniq } = require('../util')

const HASH = 'h!'
const PATH = 'p!'
const HOLDER = 'o!'
const TIMESTAMP = 't!'

// The files index
// TODO also parse 'rmFiles' messages

module.exports = function (level) {
  const events = new EventEmitter()
  return {
    maxBatch: 100,

    map: function (msgs, next) {
      const ops = []
      // const seen = {}
      let pending = 0
      msgs.forEach(function (msg) {
        if (!sanitize(msg)) return
        pending++
        msg.value.addFile.sha256 = msg.value.addFile.sha256.toString('hex')
        if (msg.value.addFile.metadata && typeof msg.value.addFile.metadata === 'string') msg.value.addFile.metadata = JSON.parse(msg.value.addFile.metadata)
        const sha256 = msg.value.addFile.sha256

        let merged = msg.value.addFile
        level.get(HASH + sha256, function (err, existingValue) {
          if (!(err && err.notFound)) {
            // TODO: this will clobber old values
            merged = merge(existingValue, msg.value.addFile, { arrayMerge, customMerge })
          }

          merged.holders = merged.holders || []
          if (!merged.holders.includes(msg.key)) merged.holders.push(msg.key)

          ops.push({
            type: 'put',
            key: HASH + sha256,
            value: merged
          })

          ops.push({
            type: 'put',
            key: PATH + msg.value.addFile.filename + '!' + msg.value.timestamp,
            value: sha256
          })

          ops.push({
            type: 'put',
            key: HOLDER + msg.key + '@' + msg.seq,
            value: sha256
          })

          // TODO this will clobber messages with the same timestamp
          // we should maybe add the hash to the key as well
          ops.push({
            type: 'put',
            key: TIMESTAMP + msg.value.timestamp,
            value: sha256
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
        const subdir = opts.subdir || ''
        const subdirArray = subdir.length ? (PATH + subdir).split(sep) : []
        delete opts.subdir
        const subOpts = {
          gte: PATH + subdir,
          lte: PATH + subdir + '~'
          // lte: String.fromCharCode(key.charCodeAt(0) + 1)
        }
        return pull(
          pullLevel.read(level, Object.assign(subOpts, opts)),
          pull.filter((entry) => {
            return subdir.length
              ? entry.key.split(sep).slice(0, subdirArray.length).join(sep) === subdirArray.join(sep)
              : true
          }),
          pull.unique((entry) => {
            if (!opts.oneLevel) return entry.value
            return entry.key.split(sep).slice(subdirArray.length)[0]
          }),
          pull.asyncMap((entry, cb) => {
            if (opts.oneLevel) {
              const remainPath = entry.key.slice(PATH.length).split(sep).slice(subdirArray.length)
              if (remainPath.length > 1) return cb(null, { dir: remainPath[0] })
            }
            core.api.files.get(entry.value, cb)
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
        let bytes = 0
        const peerFiles = {}
        pull(
          core.api.files.pullStream(opts),
          pull.drain((file) => {
            files++
            bytes += file.size
            file.holders.forEach((peer) => {
              peerFiles[peer] = peerFiles[peer] || { files: 0, bytes: 0 }
              peerFiles[peer].files++
              peerFiles[peer].bytes += file.size
            })
            return true
          }, (err) => {
            cb(err, {
              files,
              bytes,
              peerFiles
            })
          })
        )
      },
      pullStreamByTimestamp: function (core, opts = {}) {
        const subOpts = {
          keys: false,
          gte: TIMESTAMP,
          lte: TIMESTAMP + '~'
        }
        return pull(
          pullLevel.read(level, Object.assign(subOpts, opts)),
          pull.asyncMap((hash, cb) => {
            core.api.files.get(hash, cb)
          })
        )
      },
      events: events
    }
  }
}

function sanitize (msg) {
  if (typeof msg.value !== 'object') return null
  if (msg.value.addFile) return msg // TODO || fileComment || rmFiles
  return null
}

function arrayMerge (destArray, sourceArray) {
  return uniq(destArray.concat(sourceArray))
}

function customMerge (key) {
  if (key === 'filename') {
    return function (a, b) {
      if (a === b) return a
      if (!Array.isArray(a)) a = [a]
      if (!Array.isArray(b)) b = [b]
      return arrayMerge(a, b)
    }
  }
}
