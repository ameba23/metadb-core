const kappa = require('kappa-core')
const path = require('path')
const mkdirp = require('mkdirp')
const KappaPrivate = require('kappa-private')
const level = require('level') // -mem ?
const sublevel = require('subleveldown')
const os = require('os')
// const thunky = require('thunky')

const createFilesView = require('./views/files')
const createPeersView = require('./views/peers')
const createRequestsView = require('./views/requests')

const IndexFiles = require('./index-files')
const Swarm = require('./swarm')
const config = require('./config')
const Query = require('./queries')
const Publish = require('./publish')

const LOCAL_FEED = 'local'
const DB = (dir) => path.join(dir, 'feeds')
const VIEWS = (dir) => path.join(dir, 'views')

const FILES = 'f'
const PEERS = 'p'
const REQUESTS = 'r'
const SHARES = 's'

module.exports = (opts) => new MetaDb(opts)

class MetaDb {
  constructor (opts = {}) {
    this.indexesReady = false
    this.storage = opts.path || path.join(os.homedir(), '.metadb')
    mkdirp.sync(this.storage)
    this.kappaPrivate = KappaPrivate()

    this.peerNames = {}
    this.repliedTo = []
    this.config = {}
    this.config.shares = {}
    this.connections = {}
    this.query = Query(this)
    this.publish = Publish(this)

    this.core = kappa(
      DB(this.storage),
      { valueEncoding: this.kappaPrivate.encoder() }
    )
    this.db = level(VIEWS(this.storage))
    this.core.use('files', createFilesView(
      sublevel(this.db, FILES, { valueEncoding: 'json' })
    ))
    this.core.use('peers', createPeersView(
      sublevel(this.db, PEERS, { valueEncoding: 'json' })
    ))
    this.core.use('requests', createRequestsView(
      sublevel(this.db, REQUESTS, { valueEncoding: 'json' })
    ))

    this.sharedb = sublevel(this.db, SHARES)
    this.files = this.core.api.files
    this.peers = this.core.api.peers
    this.requests = this.core.api.requests
    this.requests.events.on('update')
  }

  ready (cb) {
    this.core.writer(LOCAL_FEED, (err, feed) => {
      if (err) return cb(err)
      feed.ready(() => {
        this.localFeed = feed
        this.key = feed.key
        this.keyHex = feed.key.toString('hex')
        this.kappaPrivate.secretKey = feed.secretKey
        this.loadConfig(cb)
      })
    })
  }

  buildIndexes (cb) {
    this.core.ready(() => {
      // should we do if (this.key) ?
      this.indexesReady = true
      cb()
    })
  }

  // readMessages (cb) {
  getSettings (cb) {
    if (!this.indexesReady) this.buildIndexes(this.getSettings(cb))
    this.query.peers(() => {
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

  shares () {
    // TODO: this should map shares to files somehow for displaying in the interface
    // Object.keys(this.config.shares).forEach(n, i) {
    //   }
    // )
  }

  writeConfig (cb) { return config.save(this)(cb) }
  loadConfig (cb) { return config.load(this)(cb) }

  swarm (key, cb) { return Swarm(this)(key, cb) }
  unswarm (key, cb) { return Swarm.unswarm(this)(key, cb) }
}
