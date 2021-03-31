const messages = require('./messages')
const raf = require('random-access-file')
const crypto = require('../crypto')
const HashPieces = require('./hash-pieces')
const debug = require('debug')
const path = require('path')
const fs = require('fs')
const { printKey, toString } = require('../util')
const speedometer = require('speedometer')

// Manage downloads - one instance per connected peer

module.exports = class Peer {
  constructor (feed, options = {}) {
    const self = this
    this.feed = feed
    this.keyHex = toString(feed.key)
    this.noiseKey = crypto.edToCurvePk(feed.key)
    this.currentDownloads = new Map()
    this.downloadPath = options.downloadPath || '.'
    this.requested = new Map()
    this.log = options.log || debug('metadb-download')
    this.options = options
    this.emit = function (event, info = {}) {
      this.options.emit(event, Object.assign(info, { peer: self.keyHex }))
    }

    this.extensions = {
      request: feed.registerExtension('request', { encoding: messages.Request }),
      data: feed.registerExtension('data', {
        encoding: messages.Data,
        onmessage (message, peer) {
          // TODO check peer key
          self.onData(message, peer)
        }
      }),
      refuse: feed.registerExtension('refuse', {
        encoding: messages.Refuse,
        onmessage (message, peer) {
          self.onRefuse(message, peer)
        }
      }),
      hello: feed.registerExtension('hello', { encoding: messages.Hello }),
      ack: feed.registerExtension('ack', { encoding: messages.Ack })
    }

    function checkNoiseKey (peer) {
      return Buffer.compare(peer.remotePublicKey, self.noiseKey) === 0
    }

    feed.on('peer-open', (peer) => {
      self.log('opened connection to peer as client', printKey(peer.remotePublicKey), peer.stream.stream.initiator)
      if (checkNoiseKey(peer)) { // && !feed.peers.filter(checkNoiseKey).length)
        self.connection = true
        self.emit('connection', peer.remotePublicKey)

        self.extensions.hello.send({ feed: self.options.ownKey }, peer)
        return
      }
      // TODO close the connection otherwise?
      self.log('peer has unexpected key')
    })

    feed.on('peer-remove', (peer) => {
      self.log('peer disconnected', printKey(peer.remotePublicKey), peer.stream.stream.initiator)
      if (checkNoiseKey(peer) && !feed.peers.filter(checkNoiseKey).length) {
        self.connection = false
        self.emit('disconnection')

        // Gracefully close download
        if (this.currentDownloads.size) {
          // TODO iterate: (this.currentDownload.position < this.currentDownload.size)) {
          // this.emit('incomplete', download)
        }
      }
    })
  }

  async onData (dataMessage, peer) {
    const self = this
    const sha256 = toString(dataMessage.sha256)
    if (!this.requested.has(sha256)) return this.log('Received chunk from unrequested file - ignoring')

    if (!this.currentDownloads.has(sha256)) {
      const { filename, size, mimeType } = this.requested.get(sha256)
      this.log('Downloading file', filename)
      this.currentDownloads.set(sha256, {
        sha256,
        size,
        filename,
        mimeType,
        file: raf(path.join(this.downloadPath, filename + '.part')),
        hashPieces: new HashPieces(this.requested.offset),
        speed: speedometer()
      })
    }

    const download = this.currentDownloads.get(sha256)

    await new Promise((resolve, reject) => {
      download.file.write(dataMessage.offset, dataMessage.data, (err) => {
        if (err) return reject(err)
        resolve()
      })
    })

    download.hashPieces.add(dataMessage.offset, dataMessage.data)

    const kbps = parseInt(download.speed(dataMessage.data.length) * 0.008)
    this.log(`${kbps} k bits per second`)
    this.emit('download', {
      sha256,
      filename: download.filename,
      size: download.size,
      mimeType: download.mimeType,
      bytesReceived: download.hashPieces.bytesReceived,
      kbps
    })

    if (download.hashPieces.bytesReceived === download.size) {
      this.log('download complete!')
      const hash = await download.hashPieces.final(download.file)
      const verified = download.sha256 === toString(hash)
      this.log(verified ? 'verified' : 'could not verify')
      this.emit('downloaded', {
        verified,
        mimeType: download.mimeType,
        filename: download.filename,
        sha256
      })
      download.file.close()

      // Remove .part suffix
      const fullPath = path.join(self.downloadPath, download.filename)
      await new Promise((resolve, reject) => {
        fs.rename(fullPath + '.part', fullPath, (err) => {
          if (err) {
            self.log('Cannot rename downloaded file!')
            return reject(err)
          }
          resolve()
        })
      })

      self.requested.delete(sha256)
      this.currentDownloads.delete(sha256)
      this.extensions.ack.send({ file: { sha256: Buffer.from(sha256, 'hex') } }, peer)
    }
  }

  async sendRequest (request, info) {
    if (this.requested.has(toString(request.file.sha256))) return
    const { mimeType } = info // TODO , hashState for partially dled file
    // if (this.currentDownloads.size) return this.requestQueue.push(request)
    const fileObject = await this.hashesToFilenames(request.file.sha256)
      .catch(() => { return {} })
    if (!fileObject.filename) {
      throw new Error('Cannot find file in peers feed when making request')
    }
    fileObject.mimeType = mimeType
    const peer = await this.getPeer()
    this.extensions.request.send(request, peer)
    this.requested.set(toString(request.file.sha256), fileObject)
  }

  async getPeer () {
    const self = this
    function checkNoiseKey (peer) {
      return Buffer.compare(peer.remotePublicKey, self.noiseKey) === 0
    }
    const connections = this.feed.peers.filter(checkNoiseKey)
    if (connections.length === 1) return connections[0]
    if (!connections.length) return Promise.reject(new Error('No peer connected'))

    // wait for a connection to be dropped
    await new Promise((resolve, reject) => {
      self.feed.once('peer-remove', (peer) => {
        if (checkNoiseKey) resolve()
      })
    })
    return self.getPeer()
  }

  onRefuse (refusal, peer) {
    // TODO
    console.log('got refusal', refusal)
  }

  unrequest (request) {
    // TODO this.requested.delete(hash)
    // cancel current download if it has the same hash
  }

  async hashesToFilenames (hash) {
    for await (const entry of this.feed.createReadStream()) {
      if (entry.addFile && (Buffer.compare(entry.addFile.sha256, hash) === 0)) {
        return entry.addFile
      }
    }
    return Promise.reject(new Error('hash not found in feed'))
  }
}
