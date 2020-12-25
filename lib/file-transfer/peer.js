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
  constructor (feed, handlers, options = {}) {
    const self = this
    this.feed = feed
    this.downloadPath = options.downloadPath || '.'
    this.requested = new Map()
    this.handlers = handlers
    this.log = options.log || debug('metadb-download')

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
      })
    }

    feed.on('peer-open', (peer) => {
      self.log('opened connection to peer as client', printKey(peer.remotePublicKey))
      if (Buffer.compare(peer.remotePublicKey, crypto.edToCurvePk(feed.key)) === 0) {
        self.connection = peer
        // TODO this is the place to check our wish list for files this peer has
        return
      }
      // TODO close the connection otherwise?
      self.log('peer has unexpected key')
    })

    feed.on('peer-remove', (peer) => {
      self.log('peer disconnected')
      if (Buffer.compare(peer.remotePublicKey, crypto.edToCurvePk(feed.key)) === 0) {
        self.connection = false
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
        if (err) throw err // TODO
        resolve()
      })
    })

    download.hashPieces.add(dataMessage.offset, dataMessage.data)
    console.log(download.speed(dataMessage.data.length) * 8, 'bits per second')

    if (download.hashPieces.bytesReceived === download.size) {
      this.log('download complete!')
      const hash = await download.hashPieces.final(download.file)
      if (download.sha256 === toString(hash)) {
        console.log('verified')
      } else {
        console.log('could not verify!')
      }
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
    const fileObject = await this.handlers.hashesToFilenames(request.file.sha256)
      .catch(() => { return {} })
    if (!fileObject.filename) {
      console.log('cannot find file in peers feed') // TODO
      return
    }
    this.extensions.request.send(request, this.connection)
    this.requested.set(toString(request.file.sha256), fileObject)
  }

  sendMessage (type, message) {
    if (type === 'request') return this.sendRequest(message)
    this.extensions[type].send(message, this.connection)
  }

  onRefuse (refusal, peer) {
    // TODO
    console.log('got refusal', refusal)
  }

  unrequest (request) {
    // TODO this.requested.delete(hash)
    // cancel current download if it has the same hash
  }
}
