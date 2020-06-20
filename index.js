const kappa = require('kappa-core')
const path = require('path')
const mkdirp = require('mkdirp')
const KappaPrivate = require('kappa-private')
const level = require('level') // -mem ?
const sublevel = require('subleveldown')
const homeDir = require('os').homedir()
const EventEmitter = require('events').EventEmitter
// const thunky = require('thunky')
const log = console.log // TODO

const createFilesView = require('./views/files')
const createPeersView = require('./views/peers')
// const createInvitesView = require('./views/invites')

const IndexFiles = require('./index-files')
const Swarm = require('./swarm')
const config = require('./config')
const crypto = require('./crypto')
const Query = require('./queries')
const Publish = require('./publish')

const LOCAL_FEED = 'local'
const DB = (dir) => path.join(dir, 'feeds')
const VIEWS = (dir) => path.join(dir, 'views')

const FILES = 'f'
const PEERS = 'p'
const REQUESTS = 'r'
// const INVITES = 'i'
const SHARES = 's'

module.exports = (opts) => new MetaDb(opts)

class MetaDb {
  constructor (opts = {}) {
    this.indexesReady = false
    this.storage = opts.storage || path.join(homeDir, '.metadb')
    mkdirp.sync(this.storage)
    this.kappaPrivate = KappaPrivate()
    this.isTest = opts.test

    // TODO downloadPath should be retrieved from and saved to config file
    this.downloadPath = opts.test
      ? path.join(this.storage, 'downloads')
      : path.join(this.storage, 'downloads') // os.homedir(), 'Downloads' ?
    mkdirp.sync(this.downloadPath)

    this.peerNames = {}
    this.repliedTo = []
    this.config = {}
    this.config.shares = {}
    this.connections = {}
    this.query = Query(this)
    this.publish = Publish(this)
    this.connectedPeers = {}
    this.uploadQueue = []

    this.core = kappa(
      DB(this.storage), {
        valueEncoding: this.kappaPrivate.encoder(),
        // multifeed gets a generic key, so we can use a single
        // instance for multiple 'swarms'
        encryptionKey: crypto.keyedHash('metadb')
      }
    )

    this.db = level(VIEWS(this.storage))
    this.core.use('files', createFilesView(
      sublevel(this.db, FILES, { valueEncoding: 'json' })
    ))
    this.core.use('peers', createPeersView(
      sublevel(this.db, PEERS, { valueEncoding: 'json' })
    ))
    // this.core.use('invites', createInvitesView(
    //   sublevel(this.db, INVITES, { valueEncoding: 'json' })
    // ))
    this.requestsdb = sublevel(this.db, REQUESTS, { valueEncoding: 'json' })

    this.sharedb = sublevel(this.db, SHARES, { valueEncoding: 'json' })
    this.shareTotals = sublevel(this.db, 'ST')
    this.swarmdb = sublevel(this.db, 'SW', { valueEncoding: 'json' })
    this.files = this.core.api.files
    this.peers = this.core.api.peers
    // this.invites = this.core.api.invites
    this.events = new EventEmitter()
    this.files.events.on('update', () => {})
    this.peers.events.on('update', () => {})
  }

  ready (cb) {
    this.core.writer(LOCAL_FEED, (err, feed) => {
      if (err) return cb(err)
      feed.ready(() => {
        this.localFeed = feed
        this.key = feed.key
        this.keypair = {
          publicKey: feed.key,
          secretKey: feed.secretKey
        }
        this.keyHex = feed.key.toString('hex')
        this.kappaPrivate.secretKey = feed.secretKey
        this.events.emit('ws', 'ready')

        // Connect to swarms if any were left connected:
        Swarm.loadSwarms(this)((err) => {
          if (err) log('reading swarmdb:', err) // TODO
          this.loadConfig((err) => {
            if (err) return cb(err)
            if (this.localFeed.length) return cb()
            // if there are no messages in the feed, publish a header message
            this.localFeed.append({
              type: 'metadb-header',
              version: '1.0.0',
              timestamp: Date.now()
            }, cb)
          })
        })
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

  getSettings (cb) {
    if (!this.indexesReady) this.buildIndexes(this.getSettings(cb))
    this.query.peers((err, peers) => {
      if (err) return cb(err)
      cb(null, {
        key: this.keyHex,
        filesInDb: this.filesInDb,
        bytesInDb: this.bytesInDb,
        peers,
        peerNames: this.peerNames,
        connections: Object.keys(this.connections),
        config: this.config,
        connectedPeers: Object.keys(this.connectedPeers),
        downloadPath: this.downloadPath,
        homeDir
      })
    })
  }

  setSettings (settings, cb) {
    const self = this
    if (settings.name) {
      // TODO check this is not our current name before publishing
      this.publish.about(settings.name, done)
    }
    if (settings.downloadPath && (this.downloadPath !== settings.downloadPath)) {
      this.downloadPath = settings.downloadPath
      mkdirp.sync(this.downloadPath)
      done()
    }
    function done (err) {
      if (err) return cb(err)
      self.getSettings(cb)
    }
  }

  indexFiles (dir, opts, started, finished) { return IndexFiles(this)(dir, opts, started, finished) }

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

  stop (cb) {
    // TODO: gracefully stop transfers
    this.unswarm(null, (err) => {
      if (err) log('Difficulty disconnecting from swarm', err)
      cb()
      process.exit(0)
    })
  }

  emitWs (messageObject) {
    this.events.emit('ws', JSON.stringify(messageObject))
  }
}
