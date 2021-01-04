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
      byPath: async function * (kappa, subdir, opts) {
        if (typeof subdir === 'object' && !opts) {
          opts = subdir
          subdir = opts.subdir
        }
        subdir = subdir || ''
        opts = opts || {}

        // Remove trailing /
        if (subdir.slice(-1) === sep) subdir = subdir.slice(0, -1)

        const subdirArray = subdir.length ? (PATH + subdir).split(sep) : []
        delete opts.subdir
        const subOpts = {
          gte: PATH + subdir,
          lte: PATH + subdir + '~'
          // lte: String.fromCharCode(key.charCodeAt(0) + 1)
        }

        const source = opts.source ? opts.source() : level.createReadStream(Object.assign(subOpts, opts))
        const seen = {}
        for await (const entry of source) {
          if (!opts.oneLevel) {
            yield kappa.api.files.get(entry.value)
            continue
          }
          const filePath = entry.key.slice(0, entry.key.lastIndexOf('!'))
          const currentPath = filePath.split(sep).slice(subdirArray.length)[0]
          if (seen[currentPath]) continue
          seen[currentPath] = true

          const pathName = entry.key.split('!')[1]
          const remainPath = pathName.split(sep).slice(subdirArray.length)
          if (remainPath.length > 1) {
            yield {
              dir: remainPath[0],
              fullPath: subdir.length ? [subdir, remainPath[0]].join(sep) : remainPath[0]
            }
            continue
          }
          const file = await kappa.api.files.get(entry.value).catch(() => {}) // TODO
          file.filename = remainPath.join(sep)
          yield file
        }
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

      byHolders: async function * (kappa, holders = [], opts = {}) {
        let subdir = opts.subdir || ''
        // Remove trailing /
        if (subdir.slice(-1) === sep) subdir = subdir.slice(0, -1)

        opts.source = async function * () {
          for await (const holder of holders) {
            for await (const entry of level.createReadStream(Object.assign({
              gte: HOLDER + holder + '!' + subdir,
              lte: HOLDER + holder + '!' + subdir + '~'
            }, opts))) {
              entry.key = PATH + entry.key.split('!')[2] + '!'
              yield entry
            }
          }
        }
        yield * kappa.api.files.byPath(opts)
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
      byTimestampToHash: async function * (kappa, opts = {}) {
        const subOpts = {
          gte: TIMESTAMP,
          lte: TIMESTAMP + '~'
        }
        for await (const key of level.createKeyStream(Object.assign(subOpts, opts))) {
          yield key.slice(-64)
        }
      },
      byTimestamp: async function * (kappa, opts = {}) {
        for await (const hash of kappa.api.files.byTimestampToHash(opts)) {
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

      filenameSubstring: async function * (kappa, searchterm) {
        const substrings = searchterm.split(' ').map(s => s.toLowerCase())
        for await (const file of kappa.api.files.stream()) {
          let found = 0
          substrings.forEach(substring => {
            const filename = file.filename.toString().toLowerCase()

            // search term beginning with ! filter results which do not contain the term
            if (substring[0] === '!') {
              if (filename.includes(substring.slice(1))) return 0
            } else {
              if (filename.includes(substring)) found++
            }
          })
          // TODO: sort them by 'found'
          if (found) yield file
        }
      },
      events: events
    }
  }
}
