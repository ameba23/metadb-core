const { EventEmitter } = require('events')
const merge = require('deepmerge')
const pullLevel = require('pull-level')
const pull = require('pull-stream')
const { sep } = require('path')
const { uniq } = require('../util')
const pullMany = require('pull-many')

// The files index
// Parses messages to add, remove and comment on files

const HASH = 'h!'
const PATH = 'p!'
const HOLDER = 'o!'
const TIMESTAMP = 't!'
const COMMENTS = 'c!'
const STARS = 's!'

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
                  pull(
                    pullLevel.read(level, {
                      keys: true,
                      gte: HOLDER + msg.key,
                      lte: HOLDER + msg.key + '~'
                    }),
                    pull.find((m) => {
                      return m.value === sha256
                    }, (err, entry) => {
                      if (err) console.log(err) // TODO
                      ops.push({
                        type: 'del',
                        key: entry.key
                      })
                      // const filename = entry.key.split('!')[2]
                      // if there are no more holders, find and rm related path and timestamp references
                      // ops.push({
                      //   type: 'del',
                      //   key: PATH + msg.value.addFile.filename + '!' + msg.value.timestamp
                      // })
                      // ops.push({
                      //   type: 'del',
                      //   key: TIMESTAMP + msg.value.timestamp + '!' + sha256
                      // })
                    })
                  )
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
              key: HOLDER + msg.key + '!' + msg.value.addFile.filename, // + '!' + msg.seq,
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
          // Process comments:
          const sha256 = msg.value.fileComment.sha256.toString('hex')
          const fileComment = {
            metadata: {
              comments: msg.value.fileComment.comment.length
                ? [{ author: msg.key, comment: msg.value.fileComment.comment }]
                : [],
              stars: msg.value.fileComment.star ? [msg.key] : []
            }
          }
          if (msg.value.fileComment.extras.length) {
            fileComment.metadata = Object.assign(fileComment.metadata, JSON.parse(msg.value.fileComment.extras))
          }
          let merged = fileComment
          level.get(HASH + sha256, function (err, existingValue) {
            if (!(err && err.notFound)) {
              merged = merge(existingValue, fileComment, { arrayMerge })

              // Remove star:
              if (msg.value.fileComment.unstar && merged.metadata.stars) {
                merged.metadata.stars = merged.metadata.stars.filter(h => h !== msg.key)
                pull(
                  pullLevel.read(level, {
                    keys: true,
                    gte: STARS + msg.key,
                    lte: STARS + msg.key + '~'
                  }),
                  pull.find((m) => {
                    return m.value === sha256
                  }, (err, entry) => {
                    if (err) console.log(err) // TODO
                    ops.push({
                      type: 'del',
                      key: entry.key
                    })
                  })
                )
              }
            }
            ops.push({
              type: 'put',
              key: HASH + sha256,
              value: merged
            })
            if (msg.value.fileComment.comment.length) {
              ops.push({
                type: 'put',
                key: COMMENTS + msg.key + '!' + msg.value.timestamp,
                value: sha256
              })
            }
            if (msg.value.fileComment.star) {
              ops.push({
                type: 'put',
                key: STARS + msg.key + '!' + msg.value.timestamp,
                value: sha256
              })
            }
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
      get: async function (kappa, sha256) {
        return level.get(HASH + sha256)
      },
      pathToHash: (kappa, filePath, cb) => {
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
      stream (kappa, opts) {
        return level.createValueStream(Object.assign({
          gte: HASH,
          lte: HASH + '~'
        }, opts))
      },
      pullStream: (kappa, opts) => {
        return pull(
          pullLevel.read(level, Object.assign({
            keys: false,
            gte: HASH,
            lte: HASH + '~'
          }, opts)) // {live: true}
        )
      },
      pullStreamByPath: function (kappa, opts = {}) {
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
            if (!opts.oneLevel) return kappa.api.files.get(entry.value, cb)
            const pathName = entry.key.split('!')[1]
            const remainPath = pathName.split(sep).slice(subdirArray.length)
            if (remainPath.length > 1) {
              return cb(null, {
                dir: remainPath[0],
                fullPath: subdir.length ? [subdir, remainPath[0]].join(sep) : remainPath[0]
              })
            }
            kappa.api.files.get(entry.value, (err, file) => {
              if (err) return cb(err)
              file.filename = remainPath.join(sep)
              cb(null, file)
            })
          })
        )
      },

      pullStreamByHolder: function (kappa, opts = {}) {
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
            kappa.api.files.get(hash, cb)
          })
        )
      },

      pullStreamByHolders: function (kappa, opts = {}) {
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
        return kappa.api.files.pullStreamByPath(opts)
      },

      // count: function (kappa, opts = {}, cb) {
      //   let files = 0
      //   let bytes = 0
      //   const peerFiles = {}
      //   pull(
      //     kappa.api.files.pullStream(opts),
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
      pullStreamByTimestampHash: function (kappa, opts = {}) {
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
      pullStreamByTimestamp: function (kappa, opts = {}) {
        return pull(
          kappa.api.files.pullStreamByTimestampHash(opts),
          pull.asyncMap((dbkey, cb) => {
            kappa.api.files.get(dbkey, cb)
          })
        )
      },
      starsByHolder: function (kappa, holder, opts = {}) {
        return pullLevel.read(level, Object.assign({
          keys: false,
          gte: STARS + holder + '!',
          lte: STARS + holder + '!' + '~'
        }, opts))
      },
      starredFilesByHolder: function (kappa, holder, opts = {}) {
        return pull(
          kappa.api.files.starsByHolder(holder, opts),
          pull.asyncMap(kappa.api.files.get)
        )
      },
      commentsByHolder: function (kappa, holder, opts = {}) {
        return pullLevel.read(level, Object.assign({
          gte: COMMENTS + holder + '!',
          lte: COMMENTS + holder + '!' + '~'
        }, opts))
      },
      commentedFilesByHolder: function (kappa, holder, opts = {}) {
        return pull(
          kappa.api.files.commentsByHolder(holder, opts),
          pull.asyncMap(kappa.api.files.get)
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
