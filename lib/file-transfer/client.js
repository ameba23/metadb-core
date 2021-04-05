const Peer = require('./peer')
const { EventEmitter } = require('events')
const { toString, printKey } = require('../util')
const path = require('path')
const log = require('debug')('metadb-client')

module.exports = class Client extends EventEmitter {
  constructor (options) {
    super()
    const self = this
    this.options = options
    this.wishlist = options.wishlist
    this.peers = options.peers
    this.getMetadata = options.getMetadata
    this.downloadDb = options.downloadDb
    this.downloadPath = options.downloadPath
    this.on('downloaded', (downloaded) => {
      log('Downloaded file')
      self.downloadDb.put(
        `${Date.now()}!${downloaded.sha256}`,
        {
          filename: downloaded.filename,
          peer: downloaded.peer,
          verified: downloaded.verified,
          mimeType: downloaded.mimeType
        })
      if (downloaded.verified) {
        this.wishlist.del(downloaded.sha256).catch(console.log)
        log('Removed item from wish list')
      }
    })
    this.on('connection', async (remotePublicKey) => {
      const peer = self.noiseKeyToPeer(remotePublicKey)
      if (!peer) return
      // check our wishlist for anything from this peer
      for await (const item of self.wishlist.createReadStream()) {
        const metadata = await self.getMetadata(item.key).catch(() => {})
        if (!metadata) continue
        const mimeType = metadata.metadata ? metadata.metadata.mimeType : undefined

        for (const holder of metadata.holders) {
          if (holder === peer.keyHex) {
            const file = (typeof item.value === 'string')
              ? { sha256: Buffer.from(item.value, 'hex') }
              : item.value // TODO

            log(`Sending request from wishlist ${printKey(file.sha256)}`)
            peer.sendRequest({ file }, { mimeType })
          }
        }
      }
    })
  }

  addFeed (key, feed) {
    const self = this
    if (this.peers.has(toString(key))) return
    const peer = new Peer(
      feed,
      {
        ownKey: this.options.key,
        downloadPath: this.downloadPath,
        emit (...args) {
          self.emit(...args)
        }
      }
    )
    this.peers.set(toString(key), peer)
    log('Added feed')
  }

  noiseKeyToPeer (noiseKey) {
    for (const peer of this.peers.values()) {
      if (Buffer.compare(peer.noiseKey, noiseKey) === 0) {
        return peer
      }
    }
    return undefined
  }

  async request (files) {
    if (!Array.isArray(files)) files = [files]
    log('Requesting ', files.map(printKey))
    for (const file of files) {
      await this._request(file)
    }
  }

  async _request (file) {
    const self = this

    const hash = typeof file === 'string' ? file : toString(file.sha256)

    const existingEntry = await this.wishlist.get(hash).catch(() => { return undefined })
    if (existingEntry) return // TODO search for file locally / check offset
    await this.wishlist.put(hash, file).catch((err) => { throw err }) // TODO

    const metadata = await this.getMetadata(hash).catch(() => {})
    if (!metadata) return
    const mimeType = metadata.metadata ? metadata.metadata.mimeType : undefined
    log('Got metadata for requested file - holders: ', metadata.holders.map(printKey))
    for (const holder of metadata.holders) {
      // if we are connected to that peer, make the request
      const peer = self.peers.get(holder)
      if (peer && peer.connection) {
        if (typeof file === 'string') file = { sha256: Buffer.from(file, 'hex') }
        log('Found connected peer, sending request')
        peer.sendRequest({ file }, { mimeType })
      }
    }
  }

  async unrequest (files) {
    log('Unrequesting', files)
    if (!Array.isArray(files)) files = [files]
    for (const file of files) {
      await this._unrequest(file)
    }
  }

  async _unrequest (file) {
    const hash = typeof file === 'string' ? file : toString(file.sha256)
    await this.wishlist.del(hash)
    for (const peer of this.peers.values()) {
      if (peer.connection && peer.requested.has(hash)) {
        peer.unrequest(file)
      }
    }
  }

  async * getDownloads () {
    for await (const entry of this.downloadDb.createReadStream({ reverse: true })) {
      yield Object.assign({
        hash: entry.key.split('!')[1],
        timestamp: entry.key.split('!')[0]
      }, entry.value)
    }
  }

  async * listRequests () {
    for await (const entry of this.wishlist.createReadStream()) {
      yield await this.getMetadata(toString(entry.key))
    }
  }

  async getDownloadedFileByHash (hash) {
    // TODO use gt, lt to make this search more efficient
    for await (const entry of this.downloadDb.createReadStream()) {
      if (entry.key.split('!')[1] === toString(hash)) {
        entry.value.filename = path.join(this.downloadPath, entry.value.filename)
        return entry.value
      }
    }
    // TODO look for partially downloaded files
    throw new Error('Given hash not downloaded')
  }
}
