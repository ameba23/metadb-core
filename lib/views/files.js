const EventEmitter = require('events').EventEmitter
const merge = require('deepmerge')
const pullLevel = require('pull-level')
const pull = require('pull-stream')
const { sep } = require('path')
const { uniq } = require('../util')
const pullMany = require('pull-many')

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
      const totals = {
        files: 0,
        bytes: 0,
        holders: {}
      }

      let pending = 0
      msgs.forEach(function (msg) {
        if (!sanitize(msg)) return
        pending++
        if (msg.value.rmFiles) {
          pull(
            pull.values(msg.value.rmFiles.files),
            pull.asyncMap((sha256Buf, cb) => {
              const sha256 = sha256Buf.toString('hex')
              level.get(HASH + sha256, function (err, existingValue) {
                if (!(err && err.notFound)) {
                  existingValue.holders = existingValue.holders.filter(h => h !== msg.key)
                  totals.holders[msg.key] = totals.holders[msg.key] || { files: 0, bytes: 0 }
                  totals.holders[msg.key].files -= 1
                  totals.holders[msg.key].bytes -= existingValue.size
                  if (!existingValue.holders.length) {
                    totals.files -= 1
                    totals.bytes -= existingValue.size
                  }
                  ops.push({
                    type: 'put',
                    key: HASH + sha256,
                    value: existingValue
                  })
                  // TODO find related holder entry
                  // if there are no more holders, find and rm related path and timestamp references
                  // ops.push({
                  //   type: 'del',
                  //   key: PATH + msg.value.addFile.filename + '!' + msg.value.timestamp
                  // })
                  // ops.push({
                  //   type: 'del',
                  //   key: HOLDER + msg.key + '!' + msg.value.addFile.filename
                  // })
                  // ops.push({
                  //   type: 'del',
                  //   key: TIMESTAMP + msg.value.timestamp + '!' + sha256
                  // })
                }
                cb()
              })
            }),
            pull.collect(() => {
              if (!--pending) done()
            })
          )
        } else if (msg.value.addFile) {
          msg.value.addFile.sha256 = msg.value.addFile.sha256.toString('hex')
          if (msg.value.addFile.metadata && typeof msg.value.addFile.metadata === 'string') msg.value.addFile.metadata = JSON.parse(msg.value.addFile.metadata)
          const sha256 = msg.value.addFile.sha256

          let merged = msg.value.addFile
          level.get(HASH + sha256, function (err, existingValue) {
            if (!(err && err.notFound)) {
              msg.value.addFile.filename = [msg.value.addFile.filename]
              // TODO: this will clobber old values
              merged = merge(existingValue, msg.value.addFile, { arrayMerge })
            }

            merged.holders = merged.holders || []
            if (!merged.holders.includes(msg.key)) merged.holders.push(msg.key)

            totals.files += 1
            totals.bytes += merged.size
            merged.holders.forEach((holder) => {
              totals.holders[holder] = totals.holders[holder] || { files: 0, bytes: 0 }
              totals.holders[holder].files += 1
              totals.holders[holder].bytes += merged.size
            })

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
              // key: HOLDER + msg.key + '@' + msg.seq,
              key: HOLDER + msg.key + '!' + msg.value.addFile.filename, // + '!' + msg.seq
              value: sha256
            })

            ops.push({
              type: 'put',
              key: TIMESTAMP + msg.value.timestamp + '!' + sha256,
              value: 0
            })

            if (!--pending) done()
          })
        } else {
          const sha256 = msg.value.fileComment.sha256.toString('hex')
          const fileComment = {
            metadata: {
              comment: msg.value.fileComment.comment
            }
          }
          if (msg.value.fileComment.extras) {
            fileComment.metadata = Object.assign(fileComment.metadata, JSON.parse(msg.value.fileComment.extras))
          }
          if (msg.value.fileComment.star) {
            fileComment.metadata.stars = [msg.key]
          }
          let merged = fileComment
          level.get(HASH + sha256, function (err, existingValue) {
            if (!(err && err.notFound)) {
              merged = merge(existingValue, fileComment, { arrayMerge })
              if (msg.value.fileComment.unstar && merged.metadata.stars) {
                merged.metadata.stars = merged.metadata.stars.filter(h => h !== msg.key)
              }
            }
            ops.push({
              type: 'put',
              key: HASH + sha256,
              value: merged
            })
            if (!--pending) done()
          })
        }
      })
      if (!pending) done()

      function done () {
        events.emit('update', totals)
        level.batch(ops, next)
      }
    },

    indexed: (msgs) => {
      // msgs
      //   .filter(msg => Boolean(sanitize(msg)))
      //   .forEach((msg) => {
      //     events.emit('update', msg)
      //   })
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
        let subdir = opts.subdir || ''
        // Remove trailing /
        if (subdir.slice(-1) === sep) subdir = subdir.slice(0, -1)
        const subdirArray = subdir.length ? (PATH + subdir).split(sep) : []
        // const filter = opts.filter || function () { return true }
        delete opts.subdir
        const subOpts = {
          gte: PATH + subdir,
          lte: PATH + subdir + '~'
          // lte: String.fromCharCode(key.charCodeAt(0) + 1)
        }

        const source = opts.source || pullLevel.read(level, Object.assign(subOpts, opts))
        return pull(
          source,
          // pull.filter((entry) => {
          //   return subdir.length
          //     ? entry.key.split(sep).slice(0, subdirArray.length).join(sep) === subdirArray.join(sep)
          //     : true
          // }),
          pull.unique((entry) => {
            if (!opts.oneLevel) return entry.value
            const filePath = entry.key.slice(0, entry.key.lastIndexOf('!'))
            return filePath.split(sep).slice(subdirArray.length)[0]
          }),
          pull.asyncMap((entry, cb) => {
            if (!opts.oneLevel) return core.api.files.get(entry.value, cb)
            const pathName = entry.key.split('!')[1]
            const remainPath = pathName.split(sep).slice(subdirArray.length)
            if (remainPath.length > 1) {
              return cb(null, {
                dir: remainPath[0],
                fullPath: subdir.length ? [subdir, remainPath[0]].join(sep) : remainPath[0]
              })
            }
            core.api.files.get(entry.value, (err, file) => {
              if (err) return cb(err)
              file.filename = remainPath.join(sep)
              cb(null, file)
            })
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

      pullStreamByHolders: function (core, opts = {}) {
        const holders = opts.holders || []
        delete opts.holders
        let subdir = opts.subdir || ''
        // Remove trailing /
        if (subdir.slice(-1) === sep) subdir = subdir.slice(0, -1)

        opts.source = pull(
          pullMany(holders.map((holder) => {
            return pullLevel.read(level, Object.assign({
              gte: HOLDER + holder + '!' + subdir,
              lte: HOLDER + holder + '!' + subdir + '~'
            }, opts))
          })),
          // remove the holder from the key, so that we can treat
          // it the same as other entries in pullStreamByPath
          // TODO more elegant would be to put an 'agnostic' map there
          pull.map((entry) => {
            entry.key = PATH + entry.key.split('!')[2] + '!'
            return entry
          })
        )
        return core.api.files.pullStreamByPath(opts)
      },

      // count: function (core, opts = {}, cb) {
      //   let files = 0
      //   let bytes = 0
      //   const peerFiles = {}
      //   pull(
      //     core.api.files.pullStream(opts),
      //     pull.drain((file) => {
      //       files++
      //       bytes += file.size
      //       file.holders.forEach((peer) => {
      //         peerFiles[peer] = peerFiles[peer] || { files: 0, bytes: 0 }
      //         peerFiles[peer].files++
      //         peerFiles[peer].bytes += file.size
      //       })
      //       return true
      //     }, (err) => {
      //       cb(err, {
      //         files,
      //         bytes,
      //         peerFiles
      //       })
      //     })
      //   )
      // },
      pullStreamByTimestampHash: function (core, opts = {}) {
        const subOpts = {
          values: false,
          gte: TIMESTAMP,
          lte: TIMESTAMP + '~'
        }
        return pull(
          pullLevel.read(level, Object.assign(subOpts, opts)),
          pull.map(dbkey => dbkey.slice(-64))
        )
      },
      pullStreamByTimestamp: function (core, opts = {}) {
        return pull(
          core.api.files.pullStreamByTimestampHash(opts),
          pull.asyncMap((dbkey, cb) => {
            core.api.files.get(dbkey, cb)
          })
        )
      },
      events: events
    }
  }
}

function sanitize (msg) {
  if (typeof msg.value !== 'object') return null
  if (msg.value.addFile || msg.value.fileComment || msg.value.rmFiles) return msg
  return null
}

function arrayMerge (destArray, sourceArray) {
  return uniq(destArray.concat(sourceArray))
}
