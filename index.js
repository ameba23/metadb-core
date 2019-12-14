const kappa = require('kappa-core')
const path = require('path')
const mkdirp = require('mkdirp')
const kappaPrivate = require('kappa-private')
const level = require('level')
const PullQuery = require('kappa-view-pull-query')
const queryMfr = require('./query-mfr')
const os = require('os')
// const thunky = require('thunky')

const IndexFiles = require('./index-files')
const PublishAbout = require('./publish-about')
const PublishRequest = require('./publish-request')
const PublishReply = require('./publish-reply')
const Swarm = require('./swarm')
const RequestReply = require('./queries/request-reply')
const config = require('./config')
const Query = require('./queries')

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
    this.connections = {}
    this.query = Query(this)

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
    this.core.use('query', PullQuery(this.db, this.core, queryMfr))
    this.core.ready(() => {
      // should we do if (this.key)
      this.indexesReady = true
      cb()
    })
  }

  // readMessages (cb) {
  getSettings (cb) {
    if (!this.indexesReady) this.buildIndexes(this.getSettings(cb))
    this.query.abouts(() => {
      // this.requestReply(cb)
      cb(null, {
        key: this.key,
        peerNames: this.peerNames,
        connections: Object.keys(this.connections),
        config: this.config
      })
    })
  }

  indexFiles (dir, cb) { return IndexFiles(this)(dir, cb) }

  publishAbout (name, cb) { return PublishAbout(this)(name, cb) }
  publishRequest (files, cb) { return PublishRequest(this)(files, cb) }
  publishReply (...args) { return PublishReply(this)(...args) }

  shares () {
    // TODO: this should map shares to files somehow for displaying in the interface
    // Object.keys(this.config.shares).forEach(n, i) {
    //   
    //   }
    // )
  }

  // query (...args) { return Query(this)(...args) }

  requestReply (...args) { return RequestReply(this)(...args) }

  writeConfig (cb) { return config.save(this)(cb) }
  loadConfig (cb) { return config.load(this)(cb) }

  swarm (key, cb) { return Swarm(this)(key, cb) }
  unswarm (key, cb) { return Swarm.unswarm(this)(key, cb) }
}
