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
const { toString } = require('./lib/util')
const Server = require('./lib/file-transfer/server')
const Client = require('./lib/file-transfer/client')
const Views = require('./lib/views')
const { MetadbMessage } = require('./lib/messages')
const Shares = require('./lib/scan-files')
const ConfigFile = require('./lib/config')

const SHAREDB = 'S'
const INDEXQUEUE = 'I'
const WISHLIST = 'W'
const DOWNLOAD = 'D'
const UPLOAD = 'U'

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
    this.configFile = new ConfigFile(this.storage)
    this.config = {}

    this.config.downloadPath = path.join(this.storage, 'Downloads')
    // this.config.downloadPath = options.test
    //   ? path.join(this.storage, 'Downloads')
    //   : path.join(homeDir, 'Downloads')
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
    if (!this.feed.length) {
      await this.append('header', { type: 'metadb' })
    }

    this.keyHex = this.feed.key.toString('hex')

    this.config = await this.configFile.load()

    this.shares = new Shares({
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
    await this.shares.ready()

    this.noiseKeyPair = {
      publicKey: crypto.edToCurvePk(self.feed.key),
      secretKey: crypto.edToCurveSk(self.feed.secretKey)
    }

    self.client = new Client({
      wishlist: sublevel(this.db, WISHLIST, { valueEncoding: 'json' }),
      downloadDb: sublevel(this.db, DOWNLOAD, { valueEncoding: 'json' }),
      peers: this.peers,
      getMetadata (hash) {
        return self.query.files.get(hash)
      },
      downloadPath: self.config.downloadPath
    })

    self.server = new Server(this.feed, {
      uploadDb: sublevel(this.db, UPLOAD, { valueEncoding: 'json' }),
      async hashesToFilenames (hash) {
        const fileObject = await self.shares.sharedb.get(hash)
          .catch(() => {
            return {}
          })
        return fileObject
      },
      noiseKeyToFeedKey (noiseKey) {
        console.log('!!!', noiseKey)
        for (const peer of self.peers.values()) {
          if (Buffer.compare(peer.noiseKey, noiseKey) === 0) {
            return peer.keyHex
          }
        }
        return undefined
      }
    })

    self.networker = new Networker(self.store, { keyPair: this.noiseKeyPair })
  }

  async connect () {
    await this.networker.configure(this.feed.discoveryKey, { announce: true, lookup: false })
  }

  async getSettings () {
    return {
      key: this.keyHex,
      config: this.config
    }
  }

  async addFeed (key) {
    if (!this.feed) throw new Error('addFeed cannot be called before ready')
    key = toString(key)
    if (this.peers.has(key)) return
    const feed = this.store.get({ key })
    this.client.addFeed(key, feed)

    await this.networker.configure(feed.discoveryKey, { announce: false, lookup: true })
  }

  async * listSharesNewestFirst () {
    async function * reverseRead (feed) {
      for (let i = feed.length - 1; i > -1; i--) {
        yield new Promise((resolve, reject) => {
          feed.get(i, (err, entry) => {
            if (err) return reject(err)
            resolve(entry)
          })
        })
      }
    }

    for await (const entry of reverseRead(this.feed)) {
      if (!entry.addFile) continue
      const hash = toString(entry.addFile.sha256)
      const metadata = await this.query.files.get(hash)
      const { baseDir, filePath } = await this.shares.sharedb.get(hash)
      metadata.filename = path.join(baseDir, filePath)
      yield metadata
    }
  }

  async * listShares () {
    for await (const entry of this.shares.sharedb.createReadStream()) {
      const metadata = await this.query.files.get(entry.key)
      metadata.filename = path.join(entry.value.baseDir, entry.value.filePath)
      yield metadata
    }
  }

  async stop () {
    // TODO gracefully finish uploads
    // TODO gracefully finish downloads
    // TODO gracefully finish scanning files
    await this.networker.close()
  }

  // _sendMessage (recipient, type, message) { // TODO not yet used
  //   recipient = toString(recipient)
  //   if (!this.peers.has(recipient)) {
  //     return false
  //   }
  //   this.peers.get(recipient).sendMessage(type, message)
  // }

  async about (about) {
    if (typeof about === 'string') about = { name: about }
    if (about.name === '') return Promise.reject(new Error('Cannot give empty string as name'))
    await this.append('about', about)
  }

  async fileComment (commentMessage) {
    if (!commentMessage.sha256) return Promise.reject(new Error('sha256 not given'))
    commentMessage.sha256 = Buffer.from(commentMessage.sha256, 'hex')
    await this.publishMessage('fileComment', commentMessage)
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
