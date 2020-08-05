const kappa = require('kappa-core')
const path = require('path')
const mkdirp = require('mkdirp')
const level = require('level') // -mem ?
const sublevel = require('subleveldown')
const homeDir = require('os').homedir()
const EventEmitter = require('events').EventEmitter
// const thunky = require('thunky')
const log = require('debug')('metadb')

const createFilesView = require('./lib/views/files')
const createPeersView = require('./lib/views/peers')
// const createInvitesView = require('./lib/views/invites')
// const createWallMessagesView = require('./lib/views/wall-messages')

const IndexFiles = require('./lib/index-files')
const Swarm = require('./lib/swarm')
const config = require('./lib/config')
const crypto = require('./lib/crypto')
const Query = require('./lib/queries')
const Publish = require('./lib/publish')
const Request = require('./lib/file-transfer/request')
const ignore = require('./lib/ignore')
const { MetadbMessage } = require('./lib/messages')

const LOCAL_FEED = 'local'
const DB = (dir) => path.join(dir, 'feeds')
const VIEWS = (dir) => path.join(dir, 'views')

const FILES = 'f'
const PEERS = 'p'
const REQUESTS = 'r'
// const INVITES = 'i'
const SHARES = 's'
const DOWNLOADED = 'd'

module.exports = (opts) => new Metadb(opts)
module.exports.loadConfig = (opts, cb) => config.load(opts)(cb)

class Metadb {
  constructor (opts = {}) {
    this.indexesReady = false
    this.storage = opts.storage || path.join(homeDir, '.metadb')
    mkdirp.sync(this.storage)
    this.isTest = opts.test

    this.config = {}

    // TODO downloadPath should be retrieved from and saved to config file
    this.config.downloadPath = opts.test
      ? path.join(this.storage, 'downloads')
      : path.join(this.storage, 'downloads') // os.homedir(), 'Downloads' ?
    mkdirp.sync(this.config.downloadPath)

    this.peerNames = {}
    this.swarms = {}
    this.query = Query(this)
    this.publish = Publish(this)
    this.connectedPeers = {}
    this.uploadQueue = []

    this.core = kappa(
      DB(this.storage), {
        valueEncoding: MetadbMessage,
        // multifeed gets a generic key, so we can use a single
        // instance for multiple 'swarms'
        encryptionKey: crypto.keyedHash('metadb')
      }
    )
    this.db = level(VIEWS(this.storage))
    this.db.on('error', (err) => {
      if (err.type === 'OpenError') {
        console.log('Unable to open database.  Either metadb is already running or lockfile needs to be removed')
      }
      console.log(err)
    })

    this.core.use('files', createFilesView(
      sublevel(this.db, FILES, { valueEncoding: 'json' })
    ))
    this.core.use('peers', createPeersView(
      sublevel(this.db, PEERS, { valueEncoding: 'json' })
    ))
    // this.core.use('invites', createInvitesView(
    //   sublevel(this.db, INVITES, { valueEncoding: 'json' })
    // ))
    // this.core.use('wallMessages', createWallMessagesView(
    //   sublevel(this.db, WALL_MESSAGES, { valueEncoding: 'json' }),
    //   this.swarms
    // ))
    this.requestsdb = sublevel(this.db, REQUESTS, { valueEncoding: 'json' })
    this.downloadeddb = sublevel(this.db, DOWNLOADED, { valueEncoding: 'json' })
    this.sharedb = sublevel(this.db, SHARES, { valueEncoding: 'json' })
    this.shareTotals = sublevel(this.db, 'ST')
    this.swarmdb = sublevel(this.db, 'SW', { valueEncoding: 'json' })
    this.storeIndexQueue = sublevel(this.db, 'IQ', { valueEncoding: 'json' })
    this.files = this.core.api.files
    this.peers = this.core.api.peers
    // this.invites = this.core.api.invites
    this.events = new EventEmitter()
    this.files.events.on('update', () => {})
    this.peers.events.on('update', () => {})
    this.swarm = Swarm(this)()
  }

  ready (cb) {
    const self = this
    ignore(this.storage, (err, ignorePatterns) => {
      if (err) return cb(err)
      self.ignorePatterns = ignorePatterns
      self.core.writer(LOCAL_FEED, (err, feed) => {
        if (err) return cb(err)
        feed.ready(() => {
          self.localFeed = feed
          self.key = feed.key
          self.keypair = {
            publicKey: feed.key,
            secretKey: feed.secretKey
          }
          self.keyHex = feed.key.toString('hex')
          self.events.emit('ws', 'ready')

          // Connect to swarms if any were left connected:
          self.swarm.loadSwarms((err) => {
            if (err) log('Reading swarmdb:', err) // TODO
            self.loadConfig((err) => {
              if (err) return cb(err)
              self.storeIndexQueue.get('i', (err, indexQueue) => {
                if (err) {
                  if (!err.notFound) return cb(err)
                  self.indexQueue = []
                } else {
                  self.indexQueue = indexQueue
                  if (indexQueue.length) self.resumeIndexing()
                }
                if (self.localFeed.length) return cb()
                // if there are no messages in the feed, publish a header message
                self.publish.header(cb)
              })
            })
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
    const self = this
    if (!this.indexesReady) this.buildIndexes(this.getSettings(cb))
    this.query.peers((err, peers) => {
      if (err) return cb(err)

      cb(null, {
        key: self.keyHex,
        filesInDb: self.filesInDb,
        bytesInDb: self.bytesInDb,
        peers,
        peerNames: self.peerNames,
        swarms: self.swarms,
        config: self.config,
        connectedPeers: Object.keys(self.connectedPeers),
        downloadPath: self.config.downloadPath,
        homeDir,
        indexing: self.indexing,
        indexProgress: self.indexProgress
      })
    })
  }

  setSettings (settings, cb) {
    const self = this
    if (settings.name) {
      // TODO check this is not our current name before publishing
      this.publish.about(settings.name, done)
    }
    if (settings.downloadPath && (this.config.downloadPath !== settings.downloadPath)) {
      this.config.downloadPath = settings.downloadPath
      this.writeConfig()
      mkdirp.sync(this.config.downloadPath)
      done()
    }
    function done (err) {
      if (err) return cb(err)
      self.getSettings(cb)
    }
  }

  indexFiles (dir, opts, started, finished) { return IndexFiles(this)(dir, opts, started, finished) }

  cancelIndexing (dir) {
    // If no dir given, cancel the entire queue
    const dirs = dir
      ? Array.isArray(dir) ? dir : [dir]
      : this.indexQueue

    if (dirs.includes(this.indexing)) this.abortIndexing = true
    this.indexQueue = this.indexQueue.filter(d => !dirs.includes(d))
    this.storeIndexQueue.put('i', this.indexQueue)
  }

  pauseIndexing () {
    this.abortIndexing = true
  }

  resumeIndexing () {
    log(`Items in index queue: ${this.indexQueue} Resuming indexing...`)
    if (this.indexQueue.length && !this.indexing) {
      this.indexFiles(this.indexQueue.shift(), {}, () => {}, () => {})
      this.storeIndexQueue.put('i', this.indexQueue)
    }
  }

  request (...args) { return Request(this)(...args) }
  unrequest (...args) { return Request.unrequest(this)(...args) }

  writeConfig (cb) { return config.save(this)(cb) }
  loadConfig (cb) { return config.load(this)(cb) }

  stop (cb) {
    // TODO: gracefully stop transfers
    // TODO: gracefully stop file indexing
    this.swarm.disconnect(null, (err) => {
      if (err) log('Difficulty disconnecting from swarm', err)
      cb()
      process.exit(0)
    })
  }

  emitWs (messageObject) {
    // try {} catch?
    this.events.emit('ws', JSON.stringify(messageObject))
  }
}
