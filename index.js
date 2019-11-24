const kappa = require('kappa-core')
const path = require('path')
const mkdirp = require('mkdirp')
const kappaPrivate = require('kappa-private')
const level = require('level')
const Query = require('kappa-view-pull-query')
const queryMfr = require('./query-mfr')
const pull = require('pull-stream')
const os = require('os')

const IndexFiles = require('./index-files')
const PublishAbout = require('./publish-about')
const PublishRequest = require('./publish-request')
const PublishReply = require('./publish-reply')
const Swarm = require('./swarm')
const QueryFiles = require('./queries/query-files')
const QueryAbouts = require('./queries/query-abouts')
const RequestReply = require('./queries/request-reply')
const { writeConfig, loadConfig } = require('./config')

const LOCAL_FEED = 'local'
const DB = (dir) => path.join(dir, 'db')
const VIEWS = (dir) => path.join(dir, 'views')

module.exports = (opts) => new MetaDb(opts)

class MetaDb {
  constructor (opts = {}) {
    this.indexesReady = false
    this.metaDbPath = opts.path || path.join(os.homedir(), '.metadb')
    mkdirp.sync(this.metaDbPath)
    this.asymmetric = new kappaPrivate.Asymmetric()

    this.peerNames = {}
    this.repliedTo = []
    this.config = {}
    this.config.shares = {}

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
        this.key = feed.key
        kappaPrivate.getSecretKey(DB(this.metaDbPath), this.key, (err, secretKey) => {
          if (err) return cb(err)
          this.asymmetric.secretKey = secretKey
          this.loadConfig(cb)
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

  readMessages (cb) {
    if (!this.indexesReady) this.buildIndexes(this.readMessages(cb))
    this.queryAbouts(() => {
      this.requestReply(cb)
    })
  }

  indexFiles (dir, cb) { return IndexFiles(this)(dir, cb) }

  publishAbout (name, cb) { return PublishAbout(this)(name, cb) }

  publishRequest (files, recipients, cb) { return PublishRequest(this)(files, recipients, cb) }
  publishReply (...args) { return PublishReply(this)(...args) }

  queryFiles () { return QueryFiles(this)() }

  queryPeers () {
    // TODO incorporate query-abouts
    return pull(
      this.query([
        { $filter: { value: { type: 'addFile' } } },
        {
          $reduce: {
            peerId: 'key',
            numberFiles: { $count: true }
          }
        }
      ]),
      pull.map((peer) => {
        peer.name = this.peerNames[peer.peerId]
        return peer
      })
    )
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
            if (file.filename.toLowerCase().includes(substring.slice(1))) return 0
          } else {
            if (file.filename.toLowerCase().includes(substring)) found++
          }
        })
        return found
      })
    )
  }

  byExtension (extensions) {
    if (typeof extensions === 'string') extensions = [extensions]
    extensions = extensions.map(e => e.toLowerCase())
    return pull(
      this.queryFiles(),
      pull.filter((file) => {
        // TODO lodash get
        return extensions.indexOf(file.filename.split('.').pop().toLowerCase()) > -1
      })
    )
  }

  requestReply (...args) { return RequestReply(this)(...args) }
  queryAbouts (cb) { return QueryAbouts(this)(cb) }

  // Generic query method
  query (query, opts = {}) {
    if (!this.indexesReady) throw new Error('Indexes not ready, run buildIndexes')
    return pull(
      this.core.api.query.read(Object.assign(opts, { live: false, reverse: true, query }))
    )
  }

  writeConfig (cb) { return writeConfig(this)(cb) }
  loadConfig (cb) { return loadConfig(this)(cb) }

  swarm (key) { return Swarm(this)(key) }
}
