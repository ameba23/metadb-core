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
      hello: feed.registerExtension('hello', { encoding: messages.Hello })
    }

    function checkNoiseKey (peer) {
      return Buffer.compare(peer.remotePublicKey, self.noiseKey) === 0
    }

    feed.on('peer-open', (peer) => {
      self.log('opened connection to peer as client', printKey(peer.remotePublicKey), peer.stream.stream.initiator)
      if (checkNoiseKey(peer)) { // && !feed.peers.filter(checkNoiseKey).length)
        self.connection = true
        self.emit('connection')

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
        if (this.currentDownload && (this.currentDownload.position < this.currentDownload.size)) {
          // this.emit('incomplete', download)
        }
      }
    })
  }

  async onData (dataMessage) {
    const self = this
    const sha256 = toString(dataMessage.sha256)
    if (!this.requested.has(sha256)) return console.log('received chunk from unrequested file - ignoring')

    if (!this.currentDownload || (this.currentDownload.sha256 !== sha256)) {
      // TODO if there was another one, log that it is incomplete, or add to a Map of current downloads
      const { filename, size } = this.requested.get(sha256)
      this.log('downloading file', filename)
      this.currentDownload = {
        sha256,
        size,
        filename,
        file: raf(path.join(this.downloadPath, filename + '.part')),
        hashPieces: new HashPieces(this.requested.offset),
        speed: speedometer()
      }
    }

    const download = this.currentDownload

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
      sha256: download.sha256,
      filename: download.filename,
      size: download.size,
      bytesReceived: download.hashPieces.bytesReceived,
      kbps
    })

    if (download.hashPieces.bytesReceived === download.size) {
      this.log('download complete!')
      const hash = await download.hashPieces.final(download.file)
      const verified = download.sha256 === toString(hash)
      this.log(verified ? 'verified' : 'could not verify')
      this.emit('downloaded', { verified, sha256: download.sha256 })
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

      self.requested.delete(download.sha256)
      delete self.currentDownload

      // TODO either acknoledge the dl, or send the next request
    }
  }

  async sendRequest (request, hashState) {
    if (this.currentDownload) return this.requestQueue.push(request)
    const fileObject = await this.hashesToFilenames(request.file.sha256)
      .catch(() => { return {} })
    if (!fileObject.filename) {
      console.log('cannot find file in peers feed') // TODO
      return
    }
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