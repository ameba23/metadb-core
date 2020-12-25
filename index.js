const Corestore = require('corestore')
const Networker = require('@corestore/networker')
const level = require('level')
const mkdirp = require('mkdirp')
const homeDir = require('os').homedir()
const path = require('path')
const sublevel = require('subleveldown')
// const EventEmitter = require('events')
// const debug = require('debug')('thing')
const crypto = require('./lib/crypto')
const { printKey, toString } = require('./lib/util')
const Server = require('./lib/file-transfer/server')
const Peer = require('./lib/file-transfer/peer')
const Views = require('./lib/views')
const { MetadbMessage } = require('./lib/messages')
const ScanFiles = require('./lib/scan-files')

const SHAREDB = 'S'
const INDEXQUEUE = 'I'

module.exports = class Metadb {
  constructor (options = {}) {
    this.storage = options.storage || path.join(homeDir, '.metadb')
    mkdirp.sync(this.storage)
    this.options = options
    this.store = options.corestore || new Corestore(path.join(this.storage, 'feeds'), { valueEncoding: MetadbMessage })
    this.db = level(path.join(this.storage, 'db'))
    this.peers = new Map()
    this.views = new Views(this.store, this.db)
    this.query = this.views.kappa.view
  }

  async ready () {
    await this.store.ready()
    const self = this
    this.feed = this.options.feed || this.store.default()

    await new Promise((resolve, reject) => {
      if (self.feed.secretKey) {
        resolve()
      } else {
        self.feed.once('ready', resolve)
      }
    })

    this.keyHex = this.feed.key.toString('hex')

    this.scanFiles = new ScanFiles({
      db: sublevel(this.db, SHAREDB, { valueEncoding: 'json' }),
      indexQueueStore: sublevel(this.db, INDEXQUEUE, { valueEncoding: 'json' }),
      storage: this.storage,
      async pauseIndexing () {
        return self.views.pauseIndexing()
      },
      resumeIndexing () {
        self.views.kappa.resume()
      }
    }).on('entry', (entry) => {
      this.append('addFile', entry)
    })
    await this.scanFiles.ready()

    this.noiseKeyPair = {
      publicKey: crypto.edToCurvePk(self.feed.key),
      secretKey: crypto.edToCurveSk(self.feed.secretKey)
    }

    self.server = new Server(this.feed, {
      async hashesToFilenames (hash) {
        const fileObject = await self.scanFiles.sharedb.get(hash)
          .catch(() => {
            return {}
          })
        return fileObject
      }
    })

    self.networker = new Networker(self.store, { keyPair: this.noiseKeyPair })
    if (!this.options.dontConnect) {
      await self.networker.configure(self.feed.discoveryKey, { announce: true, lookup: false })
    }
  }

  async addFeed (key) {
    if (!this.feed) throw new Error('addFeed cannot be called before ready')
    const feed = this.store.get({ key })
    this.peers.set(toString(key), new Peer(
      feed,
      {
        async hashesToFilenames (hash) {
          return new Promise((resolve, reject) => {
            feed.createReadStream()
              .on('data', (entry) => {
                if (entry.addFile && (Buffer.compare(entry.addFile.sha256, hash) === 0)) {
                  return resolve(entry.addFile)
                }
              })
              .on('end', reject)
              .on('error', reject)
          })
        }
      }
    ))

    await this.networker.configure(feed.discoveryKey, { announce: false, lookup: true })
  }

  async requestGeneric (file) {
    const self = this

    const hash = toString(file.sha256)

    const existingEntry = await this.wishlist.get(hash).catch(() => { return undefined })

    if (existingEntry) return // TODO search for file locally / check offset

    await this.wishlist.put(hash, file).catch((err) => { throw err }) // TODO

    const metadata = await this.query.files.get(hash).catch(() => {
      return undefined
    })
    if (!metadata) return
    metadata.holders.forEach((holder) => {
      // if we are connected to that peer, make the request
      if (self.peers.has(holder) && self.peers.get(holder).connection) {
        self.request(Buffer.from(holder, 'hex'), { file: { sha256: Buffer.from(hash, 'hex') } })
      }
    })
  }

  async unrequest (file) {
    const hash = toString(file.sha256)
    await this.wishlist.del(hash)
    for (const peer of this.peers.values()) {
      if (peer.connection && peer.requested.has(hash)) {
        peer.unrequest(file)
      }
    }
  }

  request (key, message) {
    this._sendMessage(key, 'request', message)
  }

  stop () {
    // TODO gracefully finish uploads
    this.networker.configure(this.feed.discoveryKey, { announce: false, lookup: false })
    for (const peer of this.peers) {
      // TODO gracefully finish downloads
      this.networker.configure(peer.feed.discoveryKey, { announce: false, lookup: false })
    }
  }

  // Private methods

  _sendMessage (recipient, type, message) { // TODO not yet used
    recipient = toString(recipient)
    if (!this.peers.has(recipient)) {
      return false
    }
    this.peers.get(recipient).sendMessage(type, message)
  }

  async append (type, message) {
    await new Promise((resolve, reject) => {
      this.feed.append({
        timestamp: Date.now(),
        [type]: message
      }, (err) => {
        if (err) return reject(err)
        resolve()
      })
    })
  }
}
