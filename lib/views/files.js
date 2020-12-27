const { EventEmitter } = require('events')
const pullLevel = require('pull-level')
const pull = require('pull-stream')
const { sep } = require('path')
const pullMany = require('pull-many')
const addFileMessage = require('./addFileMessage')
const rmFilesMessage = require('./rmFilesMessage')
const fileCommentMessage = require('./fileCommentMessage')

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
      const totals = {
        files: 0,
        bytes: 0,
        holders: {}
      }

      async function processMsgs () {
        console.log('...', msgs.length)
        for await (const msg of msgs) {
          if (typeof msg.value !== 'object') continue
          if (msg.value.rmFiles) {
            ops.push(...await rmFilesMessage(msg, level, totals))
          } else if (msg.value.addFile) {
            ops.push(...await addFileMessage(msg, level, totals))
          } else if (msg.value.fileComment) {
            ops.push(...await fileCommentMessage(msg, level, totals))
          }
        }
      }

      processMsgs().then(() => {
        events.emit('update', totals)
        level.batch(ops, next)
      }).catch((err) => {
        throw err // TODO
      })
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
      async pathToHash (kappa, filePath) {
        const res = []
        for await (const row of level.createReadStream({
          gt: PATH + filePath + '!!',
          lt: PATH + filePath + '!~'
        })) {
          if (row.key.split('!')[0] === filePath) res.push(row.value)
        }
        return res
      },
      stream (kappa, opts) {
        return level.createValueStream(Object.assign({
          gte: HASH,
          lte: HASH + '~'
        }, opts))
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

      byHolder: async function * (kappa, opts = {}) {
        opts.holder = opts.holder || ''
        const subOpts = {
          keys: false,
          gte: HOLDER + opts.holder,
          lte: HOLDER + opts.holder + '~'
        }
        delete opts.holder

        for await (const hash of level.createValueStream(Object.assign(subOpts, opts))) {
          yield await kappa.api.files.get(hash)
        }
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
      byTimestampHash: function * (kappa, opts = {}) {
        const subOpts = {
          gte: TIMESTAMP,
          lte: TIMESTAMP + '~'
        }
        for (const key of level.createKeyStream(Object.assign(subOpts, opts))) {
          yield key.slice(-64)
        }
      },
      pullStreamByTimestamp: async function * (kappa, opts = {}) {
        for (const hash of kappa.api.files.pullStreamByTimestampHash(opts)) {
          yield await kappa.api.files.get(hash)
        }
      },
      starsByHolder: function (kappa, holder, opts = {}) {
        return level.createValueStream(Object.assign({
          gte: STARS + holder + '!',
          lte: STARS + holder + '!' + '~'
        }, opts))
      },
      starredFilesByHolder: async function * (kappa, holder, opts = {}) {
        for await (const hash of kappa.api.files.starsByHolder(holder, opts)) {
          yield await kappa.api.files.get(hash)
        }
      },
      commentsByHolder: function (kappa, holder, opts = {}) {
        return level.createValueStream(Object.assign({
          gte: COMMENTS + holder + '!',
          lte: COMMENTS + holder + '!' + '~'
        }, opts))
      },
      commentedFilesByHolder: async function * (kappa, holder, opts = {}) {
        for await (const hash of kappa.api.files.commentsByHolder(holder, opts)) {
          yield await kappa.api.files.get(hash)
        }
      },
      events: events
    }
  }
}
