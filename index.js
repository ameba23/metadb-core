const Corestore = require('corestore')
const Networker = require('@corestore/networker')
const level = require('level')
const mkdirp = require('mkdirp')
const homeDir = require('os').homedir()
const path = require('path')
const sublevel = require('subleveldown')
const EventEmitter = require('events')
const log = require('debug')('metadb-core')
const crypto = require('./lib/crypto')
const { toString, isHexString, printKey } = require('./lib/util')
const Server = require('./lib/file-transfer/server')
const Client = require('./lib/file-transfer/client')
const Views = require('./lib/views')
const { MetadbMessage } = require('./lib/messages')
const Shares = require('./lib/scan-files')
const ConfigFile = require('./lib/config')
const Swarm = require('./lib/swarm')

const SHAREDB = 'S'
const SHARETOTALS = 'ST'
const INDEXQUEUE = 'I'
const WISHLIST = 'W'
const DOWNLOAD = 'D'
const UPLOAD = 'U'
const SWARM = 'M'

module.exports = class Metadb extends EventEmitter {
  constructor (options = {}) {
    super()
    this.storage = options.storage || path.join(homeDir, '.metadb')
    mkdirp.sync(this.storage)
    this.options = options
    this.store = options.corestore || new Corestore(path.join(this.storage, 'feeds'), { valueEncoding: MetadbMessage })
    this.db = level(path.join(this.storage, 'db'))
    this.peers = new Map()
    this.peerNoiseKeys = new Map()
    this.views = new Views(this.store, this.db)
    this.query = this.views.kappa.view
    this.configFile = new ConfigFile(this.storage)
    this.config = {}
    this.on('ws', console.log)

    this.config.downloadPath = path.join(this.storage, 'Downloads')
    // this.config.downloadPath = options.test
    //   ? path.join(this.storage, 'Downloads')
    //   : path.join(homeDir, 'Downloads')
    //
  }

  async ready () {
    await this.store.ready()
    const self = this
    this.feed = this.options.feed || this.store.default()

    if (!self.feed.secretKey) {
      await new Promise((resolve) => { self.feed.once('ready', resolve) })
    }

    if (!this.feed.length) {
      await this.append('header', { type: 'metadb' })
    }

    this.keyHex = this.feed.key.toString('hex')

    this.config = await this.configFile.load(this.config)

    this.shares = new Shares({
      db: sublevel(this.db, SHAREDB, { valueEncoding: 'json' }),
      shareTotalsStore: sublevel(this.db, SHARETOTALS, { valueEncoding: 'json' }),
      indexQueueStore: sublevel(this.db, INDEXQUEUE, { valueEncoding: 'json' }),
      storage: this.storage,
      async pauseIndexing () {
        return self.views.pauseIndexing()
      },
      resumeIndexing () {
        self.views.kappa.resume()
      },
      log (message) {
        log(`[shares] ${message}`)
        self.emit('ws', { indexer: message })
      }
    }).on('entry', (entry) => {
      this.append('addFile', entry)
    }).on('start', (dir) => {
      this.emit('ws', { indexingFiles: dir })
    }).on('finish', ({ filesParsed, filesAdded, bytesAdded }) => {
      this.emit('ws', { indexingFiles: false })
    }).on('abort', () => {
      this.emit('ws', { indexingFiles: false })
    })

    await this.shares.ready()

    this.noiseKeyPair = {
      publicKey: crypto.edToCurvePk(self.feed.key),
      secretKey: crypto.edToCurveSk(self.feed.secretKey)
    }

    this.client = new Client({
      key: this.feed.key,
      wishlist: sublevel(this.db, WISHLIST, { valueEncoding: 'json' }),
      downloadDb: sublevel(this.db, DOWNLOAD, { valueEncoding: 'json' }),
      peers: this.peers,
      async getMetadata (hash) {
        // const metadata = await self.query.files.get(hash).catch(() => {})
        // if (metadata) return metadata
        // await self.views.ready()
        console.log('Querying hash', hash)
        return self.query.files.get(hash)
      },
      downloadPath: self.config.downloadPath
    })
    this.client.on('download', (info) => {
      this.emit('ws', { download: { [info.sha256]: info } })
    })
    this.client.on('downloaded', (info) => {
      this.emit('ws', { downloaded: { [info.sha256]: info } })
    })

    this.server = new Server(this.feed, {
      uploadDb: sublevel(this.db, UPLOAD, { valueEncoding: 'json' }),
      async hashesToFilenames (hash) {
        const fileObject = await self.shares.sharedb.get(hash)
          .catch(() => {
            return {}
          })
        return fileObject
      },
      noiseKeyToFeedKey (noiseKey) {
        const cached = self.peerNoiseKeys.get(noiseKey)
        if (cached) return cached
        for (const peer of self.peers.values()) {
          if (Buffer.compare(peer.noiseKey, noiseKey) === 0) {
            self.peerNoiseKeys.set(noiseKey, peer.keyHex)
            return peer.keyHex
          }
        }
        return undefined
      }
    }).on('hello', (feedKey) => {
      self.addFeed(feedKey)
    }).on('uploadQueue', (uploadQueue) => {
      self.emit('ws', { uploadQueue })
    }).on('upload', (upload) => {
      self.emit('ws', { upload: { [upload.sha256]: upload } })
    }).on('uploaded', (uploaded) => {
      self.emit('ws', { uploaded: { [uploaded.sha256]: uploaded } })
    })

    this.views.kappa.on('state-update', (name, state) => {
      // console.log('state-update', name, state)
      if (name === 'files') {
        self.emit('ws', { dbIndexing: (state.status !== 'ready') })
      }
    })
    this.query.files.events.on('update', (totals) => {
      self.emit('ws', { totals })
    })

    self.networker = new Networker(self.store, { keyPair: this.noiseKeyPair })
    // logEvents(self.networker)
    // self.networker.on('peer-add', () => {
    //   console.log('PEER ADD')
    // })
    this.swarm = new Swarm(
      { publicKey: this.feed.key, secretKey: this.feed.secretKey },
      sublevel(this.db, SWARM, { valueEncoding: 'json' })
    ).on('peer', (peerKey) => {
      self.addFeed(peerKey)
    })
      .on('swarm', (name, state) => {
        self.emit('ws', { swarm: { name, state } })
      })
    await this.swarm.loadPreviouslyConnected()
  }

  async connect () {
    await this.networker.configure(this.feed.discoveryKey, { announce: true, lookup: false })

    for await (const feedId of this.query.peers.feedIds()) {
      if (feedId === this.keyHex) continue
      log('Reconnecting to peer', printKey(feedId))
      await this.addFeed(feedId)
    }
  }

  async getSettings () {
    const totals = await this.query.files.getTotals().catch(() => {})
    // TODO use a cache?
    const swarms = {}
    for await (const entry of this.swarm.db.createReadStream()) {
      swarms[entry.key] = entry.value
    }
    const connectedPeers = []
    for (const peer of this.peers.entries()) {
      if (peer[1].connection) connectedPeers.push(peer[0])
    }
    return {
      key: this.keyHex,
      config: this.config,
      connectedPeers,
      swarms,
      homeDir,
      totals
    }
  }

  async setSettings ({ name, downloadPath }) {
    if (name) {
      const currentName = await this.query.peers.getName(this.keyHex).catch(undef)
      if (name !== currentName) {
        await this.about({ name })
      }
    }
    if (downloadPath && (this.config.downloadPath !== downloadPath)) {
      this.config.downloadPath = downloadPath
      await mkdirp(this.config.downloadPath)
      await this.configFile.save(this.config)
    }
    return this.getSettings()
  }

  async addFeed (key) {
    if (!this.feed) throw new Error('addFeed cannot be called before ready')
    key = toString(key)

    if (!isHexString(key, 32)) return Promise.reject(new Error('Badly formatted feedId'))
    if (this.peers.has(key)) return
    log(`Adding peer ${key}`)
    const feed = this.store.get({ key })
    this.client.addFeed(key, feed)

    this.networker.configure(feed.discoveryKey, { announce: false, lookup: true }).then(() => {
      this.emit('added', key)
    })
    const name = await this.query.peers.getName(key).catch(undef)
    this.emit('ws', { peer: { feedId: key, name } })
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
    const self = this
    // TODO gracefully finish uploads
    // TODO gracefully finish downloads
    // TODO gracefully finish scanning files
    await this.networker.close()
    await this.db.close()
    // await new Promise((resolve, reject) => {
    //   self.feed.close((err) => {
    //     if (err) return reject(err)
    //     resolve()
    //   })
    // })
    await this.store.close()
  }

  async * listPeers () {
    const { holders } = await this.query.files.getTotals().catch(() => {})
    const peers = Array.from(this.peers.keys())
    peers.push(this.keyHex)
    for (const peer of peers) {
      const name = await this.query.peers.getName(peer).catch(undef)
      // TODO stars
      yield {
        feedId: peer,
        name,
        files: holders[peer] ? holders[peer].files : undefined,
        bytes: holders[peer] ? holders[peer].bytes : undefined
      }
    }
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
    await this.append('fileComment', commentMessage)
  }

  async wallMessage (message, swarmName) {
    const plain = MetadbMessage.encode({
      wallMessage: { message },
      timestamp: Date.now()
    })

    await this.append('private', {
      symmetric: crypto.secretBox(plain, crypto.genericHash(swarmName))
    })
  }

  async append (type, message) {
    await new Promise((resolve, reject) => {
      this.feed.append({
        timestamp: type === 'private' ? undefined : Date.now(),
        [type]: message
      }, (err) => {
        if (err) return reject(err)
        resolve()
      })
    })
  }
}

// function logEvents (emitter, name) {
//   const emit = emitter.emit
//   name = name ? `(${name}) ` : ''
//   emitter.emit = (...args) => {
//     console.log(`\x1b[33m    ----${args[0]}\x1b[0m`)
//     emit.apply(emitter, args)
//   }
// }
function undef () {
  return undefined
}
