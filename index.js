const kappa = require('kappa-core')
const path = require('path')
const mkdirp = require('mkdirp')
const level = require('level')
const sublevel = require('subleveldown')
const homeDir = require('os').homedir()
const EventEmitter = require('events').EventEmitter
const pullLevel = require('pull-level')
const pull = require('pull-stream')
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
const UPLOAD = 'u'

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
        // multifeed instance for multiple 'swarms'
        encryptionKey: crypto.keyedHash('metadb')
      }
    )

    this.core.on('error', (err) => {
      console.log('Error from Kappa-core:', err)
    })

    this.db = level(VIEWS(this.storage))
    this.db.on('error', (err) => {
      if (err.type === 'OpenError') {
        console.log('Unable to open database. Either metadb is already running or lockfile needs to be removed')
      }
      console.log('Error from level', err)
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
    this.uploaddb = sublevel(this.db, UPLOAD, { valueEncoding: 'json' })
    this.sharedb = sublevel(this.db, SHARES, { valueEncoding: 'json' })
    this.shareTotals = sublevel(this.db, 'ST', { valueEncoding: 'json' })
    this.swarmdb = sublevel(this.db, 'SW', { valueEncoding: 'json' })
    this.storeIndexQueue = sublevel(this.db, 'IQ', { valueEncoding: 'json' })
    this.files = this.core.api.files
    this.peers = this.core.api.peers
    // this.invites = this.core.api.invites
    this.events = new EventEmitter()

    this.filesInDb = 0
    this.bytesInDb = 0
    this.counters = {}
    const self = this
    this.files.events.on('update', (totals) => {
      self.filesInDb += totals.files
      self.bytesInDb += totals.bytes
      Object.keys(totals.holders).forEach((holder) => {
        self.counters[holder] = self.counters[holder] || { files: 0, bytes: 0 }
        self.counters[holder].files += totals.holders[holder].files
        self.counters[holder].bytes += totals.holders[holder].bytes
      })
    })

    // this.peers.events.on('update', () => {})
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

          self.loadConfig((err) => {
            if (err) return cb(err)
            self.storeIndexQueue.get('i', (err, indexQueue) => {
              if (err) {
                if (!err.notFound) return cb(err)
                self.indexQueue = []
              } else {
                self.indexQueue = indexQueue
                // if (indexQueue.length) self.resumeIndexing()
              }
              self.emitWs({ indexQueue: self.indexQueue })
              if (self.localFeed.length) return cb()
              // if there are no messages in the feed, publish a header message
              self.publish.header(cb)
            })
          })
        })
      })
    })
  }

  buildIndexes (cb) {
    const self = this
    log('Building database indexes...')
    this.core.ready(() => {
      // should we do if (this.key) ?
      self.indexesReady = true
      log('Database indexes built')

      // Listener to indicate when further indexing is happening
      self.core._indexes.files.on('state-update', (state) => {
        if (state.state === 'idle') self.emitWs({ dbIndexing: false })
        if (state.state === 'indexing') self.emitWs({ dbIndexing: true })
      })

      // When indexing is finished, connect to swarms if any were left connected:
      self.swarm.loadSwarms((err) => {
        if (err) log('Reading swarmdb:', err) // TODO

        // Once we are finished with doing indexing, resume pulling metadata
        if (self.indexQueue.length) self.resumeIndexing()
        cb()
      })
    })
  }

  getSettings (cb) {
    const self = this
    if (!this.indexesReady) return this.buildIndexes(() => { self.getSettings(cb) })
    // if (!this.indexesReady) return cb(new Error('Indexes not ready'))
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

  indexFiles (...args) { return IndexFiles(this)(...args) }

  cancelIndexing (dir) {
    // If no dir given, cancel the entire queue
    const dirs = dir
      ? Array.isArray(dir) ? dir : [dir]
      : this.indexQueue

    if (dirs.includes(this.indexing)) this.abortIndexing = true
    this.indexQueue = this.indexQueue.filter(d => !dirs.includes(d))
    this.emitWs({ indexQueue: this.indexQueue })
    this.storeIndexQueue.put('i', this.indexQueue)
  }

  pauseIndexing (cb) {
    this.abortIndexing = true
    if (cb) cb()
  }

  resumeIndexing (cb) {
    log(`Items in index queue: ${this.indexQueue} Resuming indexing...`)
    if (this.indexQueue.length && !this.indexing) {
      this.indexFiles(this.indexQueue.shift(), {}, () => {}, () => {})
      this.emitWs({ indexQueue: this.indexQueue })
      this.storeIndexQueue.put('i', this.indexQueue)
    }
    if (cb) cb()
  }

  request (...args) { return Request(this)(...args) }
  unrequest (...args) { return Request.unrequest(this)(...args) }

  writeConfig (cb) { return config.save(this)(cb) }
  loadConfig (cb) { return config.load(this)(cb) }

  stop (cb) {
    const self = this
    // TODO: gracefully stop transfers
    // Gracefully stop file indexing
    if (!this.indexing) done()
    this.abortIndexing = done

    function done () {
      self.swarm.disconnect(null, (err) => {
        if (err) log('Difficulty disconnecting from swarm', err)
        cb()
        process.exit(0)
      })
    }
  }

  // emit events (which can be sent to the front-end over websockets)
  emitWs (messageObject) {
    // try {} catch?
    this.events.emit('ws', JSON.stringify(messageObject))
  }

  getDownloadsOrUploads (db) {
    return pull(
      pullLevel.read(db, { live: false, reverse: true }),
      pull.map(entry => {
        return Object.assign({
          hash: entry.key.split('!')[1],
          timestamp: entry.key.split('!')[0]
        }, entry.value)
      })
    )
  }

  getDownloads () {
    return this.getDownloadsOrUploads(this.downloadeddb)
  }

  getUploads () {
    return this.getDownloadsOrUploads(this.uploaddb)
  }

  getDownloadedFileByHash (hash, callback) {
    if (Buffer.isBuffer(hash)) hash = hash.toString('hex')
    const readStream = this.downloadeddb.createReadStream()
    readStream
      .on('data', (entry) => {
        if (entry.key.split('!')[1] === hash) {
          readStream.destroy()
          return callback(null, entry.value)
        }
      })
      .on('end', () => {
        return callback(new Error('Given hash not downloaded'))
      })
  }

  getShareTotals () {
    return pull(
      pullLevel.read(this.shareTotals, { live: false }),
      pull.map(entry => Object.assign({ dir: entry.key }, entry.value))
    )
  }
}
