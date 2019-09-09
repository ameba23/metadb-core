const kappa = require('kappa-core')
const path = require('path')
const mkdirp = require('mkdirp')
const kappaPrivate = require('kappa-private')
const level = require('level')
const Query = require('kappa-view-pull-query')
const queryMfr = require('./query-mfr')
const pull = require('pull-stream')

const IndexFiles = require('./index-kappacore')
const PublishAbout = require('./publish-about')
const PublishRequest = require('./publish-request')
const PublishReply = require('./publish-reply')
const Swarm = require('./swarm')
const QueryFiles = require('./queries/query-files')

const LOCAL_FEED = 'local'
const DB = (dir) => path.join(dir, 'db')
const VIEWS = (dir) => path.join(dir, 'views')

class MetaDb {
  constructor (opts = {}) {
    this.indexesReady = false
    this.metaDbPath = opts.path || './metadb'
    // this will eventually be: path.join(os.homedir(), '.metadb')
    mkdirp.sync(this.metaDbPath)
    this.asymmetric = new kappaPrivate.Asymmetric()

    this.shares = {}
    this.peerNames = {}

    this.core = kappa(
      DB(this.metaDbPath),
      { valueEncoding: this.asymmetric.encoder() }
    )
  }

  ready (cb) {
    this.core.writer(LOCAL_FEED, (err, feed) => {
      if (err) return cb(err)
      feed.ready(() => {
        this.localFeed = feed
        kappaPrivate.getSecretKey(DB(this.metaDbPath), this.localFeed.key, (err, secretKey) => {
          if (err) return cb(err)
          this.asymmetric.secretKey = secretKey
          cb()
        })
      })
    })
  }

  buildIndexes (cb) {
    this.db = level(VIEWS(this.metaDbPath))
    this.core.use('query', Query(this.db, this.core, queryMfr))
    this.core.ready(() => {
      // should we do if (this.key)
      this.indexesReady = true
      cb()
    })
  }

  indexFiles (dir, cb) { return IndexFiles(this)(dir, cb) }

  publishAbout (name, cb) { return PublishAbout(this)(name, cb) }

  publishRequest (files, recipients, cb) { return PublishRequest(this)(files, recipients, cb) }
  publishReply (key, recipient, cb) { return PublishReply(this)(key, recipient, cb) }

  queryFiles () { return QueryFiles(this)() }

  queryPeers () {
    return this.query([
      { $filter: { value: { type: 'addFile' } } },
      {
        $reduce: {
          peerId: 'key',
          numberFiles: { $count: true }
        }
      }
    ])
  }

  myFiles () {
    return pull(
      this.queryFiles(),
      pull.filter((file) => {
        // TODO use lodash get
        return file.holders
          ? file.holders.indexOf(this.localFeed.key.toString('hex')) > -1
          : false
      })
    )
  }

  filenameSubstring (substrings) {
    if (typeof substrings === 'string') substrings = [substrings]
    substrings = substrings.map(s => s.toLowerCase())
    return pull(
      this.queryFiles(),
      pull.filter((file) => {
        var found = 0
        substrings.forEach(substring => {
          // search term beginning with ! filter results which do not contain the term
          if (substring[0] === '!') {
            if (file.data.filename.toLowerCase().includes(substring.slice(1))) return 0
          } else {
            if (file.data.filename.toLowerCase().includes(substring)) found++
          }
        })
        return found
      })
    )
  }

  byExtention (extentions) {
    if (typeof extentions === 'string') extentions = [extentions]
    extentions = extentions.map(e => e.toLowerCase())
    return pull(
      this.queryFiles(),
      pull.filter((file) => {
        // TODO lodash get
        return extentions.indexOf(file.data.filename.split('.').pop().toLowerCase()) > -1
      })
    )
  }

  query (query, opts = {}) {
    if (!this.indexesReady) throw new Error('Indexes not ready, run buildIndexes')
    return pull(
      this.core.api.query.read(Object.assign(opts, { live: false, reverse: true, query }))
    )
  }

  swarm (key) { return Swarm(this)(key) }
}

module.exports = (opts) => new MetaDb(opts)
