const Peer = require('./peer')
const { EventEmitter } = require('events')
const { toString } = require('../util')

module.exports = class Client extends EventEmitter {
  constructor ({ wishlist, peers, getMetadata, downloadPath, downloadDb }) {
    super()
    this.wishlist = wishlist
    this.peers = peers
    this.getMetadata = getMetadata
    this.downloadDb = downloadDb
    this.downloadPath = downloadPath
    this.on('downloaded', (downloaded) => {
      downloadDb.put(
        `${Date.now()}!${downloaded.sha256}`,
        {
          // name: download.filename,
          from: downloaded.peer,
          verified: downloaded.verified
        })
      if (downloaded.verified) {
        this.wishlist.del(downloaded.sha256).catch(console.log)
        console.log('removed from wish list')
      }
    })
  }

  addFeed (key, feed) {
    const self = this
    const peer = new Peer(
      feed,
      {
        downloadPath: this.downloadPath,
        emit (...args) {
          self.emit(...args)
        }
      }
    )
    this.peers.set(toString(key), peer)
  }

  async request (files) {
    if (!Array.isArray(files)) files = [files]
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

    const metadata = await this.getMetadata(hash).catch(() => {
      return undefined
    })
    if (!metadata) return

    for (const holder of metadata.holders) {
      // if we are connected to that peer, make the request
      const peer = self.peers.get(holder)
      if (peer && peer.connection) {
        if (typeof file === 'string') file = { sha256: Buffer.from(file, 'hex') }
        peer.sendRequest({ file })
      }
    }
  }

  async unrequest (files) {
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
}
