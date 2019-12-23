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
            key: msg.value.sha256, // or prefix with timestamp, to make them ordered
            value: merged
          })

          byPath.get(msg.value.filename, (err, existingHashes) => {
            const hashes = (err && err.notFound) ? [] : existingHashes
            if (!hashes.includes(msg.value.sha256)) hashes.push(msg.value.sha256)
            opsByPath.push({
              type: 'put',
              key: msg.value.filename + '!' + msg.value.timestamp,
              value: hashes
            })

            if (!--pending) done()
          })
        })
      })
      if (!pending) done()

      function done () {
        byHash.batch(opsByHash, next)
        byPath.batch(opsByPath, next)
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
      getbyHash: function (core, sha256, cb) {
        // this.ready(() => {})
        // TODO buffer to hex
        byHash.get(sha256, cb)
      },
      pathToHash: (core, filePath, cb) => {
        byPath.get(filePath, cb)
      },
      pullStream: () => {
        return pull(
          pullLevel.read(byHash), // {live: true}
          pull.map(kv => kv.value)
        )
      },
      pullStreambyPath: () => {
        return pull(
          pullLevel.read(byPath),
          pull.asyncMap((hashes, cb) => {
            pull(
              pull.values(hashes),
              pull.asyncMap((hash, cb2) => {
                byHash.get(hash, cb2)
              }),
              pull.collect(cb)
            )
          }),
          pull.flatten(),
          pull.map(kv => kv.value)
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
