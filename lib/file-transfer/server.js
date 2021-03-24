const fs = require('fs')
const path = require('path')
const speedometer = require('speedometer')
const messages = require('./messages')
const { printKey, toString } = require('../util')
const crypto = require('../crypto')
const { EventEmitter } = require('events')
const log = require('debug')('metadb-server')

// Manage uploads - one instance for all connected peers

module.exports = class Server extends EventEmitter {
  constructor (feed, options) {
    super()
    this.feed = feed
    this.options = options
    this.uploadDb = options.uploadDb
    this.queue = []
    this.awaitingAck = new Set()
    const self = this
    this.extensions = {
      hello: feed.registerExtension('hello', {
        encoding: messages.Hello,
        onmessage (message, peer) {
          self.onHello(message, peer)
        },
        onerror (err) {
          log('Got badly formed hello, ignoring', err)
        }
      }),
      request: this.feed.registerExtension('request', {
        encoding: messages.Request,
        onmessage (message, peer) {
          self.onRequest(message, peer)
        },
        onerror (err) {
          log('Got badly formed request, ignoring', err)
        }
      }),
      data: this.feed.registerExtension('data', { encoding: messages.Data }),
      refuse: this.feed.registerExtension('refuse', { encoding: messages.Refuse }),
      unrequest: this.feed.registerExtension('unrequest', {
        encoding: messages.Unrequest,
        onmessage (message, peer) {
          self.onUnrequest(message, peer)
        },
        onerror (err) {
          log('Got badly formed unrequest, ignoring', err)
        }
      }),
      ack: this.feed.registerExtension('ack', {
        encoding: messages.Ack,
        onmessage (message, peer) {
          self.onAck(message, peer)
        },
        onerror (err) {
          log('Got badly formed ack, ignoring', err)
        }
      })

    }

    this.feed.on('peer-open', (peer) => {
      console.log(peer)
      const feedKey = self.options.noiseKeyToFeedKey(peer.remotePublicKey)
      log(`Peer connected as client noisekey: ${printKey(peer.remotePublicKey)} feed key: ${printKey(feedKey || '')}`)
      // TODO emit event to show a connection from this peer
    })
  }

  async onRequest (request, peer) {
    log('Got request', printKey(request.file.sha256), 'queue is ', this.queue.length)

    if (this.uploading || this.queue.length) {
      this.queue.push({ request, peer })
      this.logUploadQueue()
      // TODO should we allow multiple simultanious uploads? how many?
      // this.sendMessage(QUEUED, messages.Queued.encode({ queuePosition }))
      return
    }
    await this._upload(request, peer)
  }

  async _upload (request, peer) {
    const self = this
    const hash = toString(request.file.sha256)
    this.uploading = hash
    const { baseDir, filePath } = await this.options.hashesToFilenames(hash)
    const fullPath = path.join(baseDir, filePath)
    const to = self.options.noiseKeyToFeedKey(peer.remotePublicKey)
    let offset = 0
    let uploadError

    await new Promise((resolve, reject) => {
      if (!filePath) return reject(new Error('file not found in db'))
      const speed = speedometer()
      fs.stat(fullPath, (err, stat) => {
        if (err) return reject(err)
        const size = stat.size
        this.uploadStream = fs.createReadStream(fullPath, { start: request.file.offset }) // end: length?
          .on('data', (data) => {
            self.sendData({
              sha256: request.file.sha256,
              offset,
              data
            }, peer)
            log(`Pending: ${peer.stream.state._pending.length}`)
            offset += data.length
            const kbps = parseInt(speed(data.length) * 0.008)

            self.emit('upload', {
              sha256: hash,
              filename: fullPath,
              size,
              bytesSent: offset,
              to,
              kbps
            })
          })
          .on('end', resolve)
          .on('error', reject)
      })
    }).catch((err) => {
      self.extensions.refuse.send({ file: request.file }, peer)
      log(`Error on reading file ${filePath} ${err}`)
      uploadError = err.message
    })

    this.awaitingAck.add(hash + toString(peer.remotePublicKey))
    this.emit('uploaded', { sha256: hash, filename: fullPath, to, error: uploadError }) // , fileObject
    log('Upload complete')

    if (!uploadError) this.uploadDb.put(`${Date.now()}!${hash}`, { filename: filePath, to })

    const next = this.queue.shift()
    this.logUploadQueue()

    if (this.queue.length) {
    //   if (Buffer.compare(this.queue[0].peer.remotePublicKey, peer.remotePublicKey) === 0) {
    //     this.waiting = true
    //     await new Promise((resolve) => {
    //       setTimeout(resolve, 5000)
    //     })
    //     this.waiting = false
    //     const nextIndex = this.queue.findIndex(item => {
    //        return (Buffer.compare(item.peer.remotePublicKey, peer.remotePublicKey) !== 0)
    //     })
    //     const next = this.queue[nextIndex]
    //
    //   }
      await this._upload(next.request, next.peer)
    } else {
      this.uploading = false
    }
  }

  logUploadQueue () {
    this.emit('uploadQueue', this.queue.map(item => {
      // TODO cache these keys
      // const feedKey = self.options.noiseKeyToFeedKey(peer.remotePublicKey)
      return item.request
    }))
  }

  onAck (ackMessage, peer) {
    // const deleted = this.awaitingAck.delete(toString(ackMessage.file.sha256) + toString(peer.remotePublicKey))
    log('ack received', ackMessage)
    // if (!deleted) return
    // unblock peer
  }

  onUnrequest (unrequest, peer) {
    log('Got unrequest', unrequest)
    if (!unrequest.file.sha256) return
    this.queue = this.queue.filter(i => i.request.file.sha256 !== unrequest.file.sha256)
    this.logUploadQueue()
    if (this.uploading === unrequest.file.sha256) this.abortCurrentUpload()
  }

  abortCurrentUpload (finish) {
    if (!this.uploading) return
    this.uploadStream.destroy()

    if (finish) return

    const next = this.queue.shift()
    this.logUploadQueue()
    if (next) return this._upload(next.request, next.peer)
    this.uploading = false
  }

  async gracefulExit () {
    // resolves when the current file has finished uploading
    this.queue = []
    if (!this.uploading) return
    this.logUploadQueue()
    return new Promise((resolve, reject) => {
      this.uploadStream.on('end', resolve).on('error', reject)
    })
  }

  sendData (dataMsg, peer) {
    this.extensions.data.send(dataMsg, peer)
  }

  onHello (hello, peer) {
    log('Got hello message')
    if (Buffer.compare(crypto.edToCurvePk(hello.feed), peer.remotePublicKey) === 0) {
      this.emit('hello', hello.feed)
    } else {
      log('Cannot verify key from hello message!')
      // TODO drop the connection to this peer
    }
  }

  async * getUploads () {
    for await (const entry of this.uploadDb.createReadStream({ reverse: true })) {
      yield Object.assign({
        hash: entry.key.split('!')[1],
        timestamp: entry.key.split('!')[0]
      }, entry.value)
    }
  }
}
