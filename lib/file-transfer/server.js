const fs = require('fs')
const path = require('path')
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
          log('got badly formed hello, ignoring', err)
        }
      }),
      request: this.feed.registerExtension('request', {
        encoding: messages.Request,
        onmessage (message, peer) {
          self.onRequest(message, peer)
        },
        onerror (err) {
          log('got badly formed req, ignoring', err)
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
          log('got badly formed unrequest, ignoring', err)
        }
      }),
      ack: this.feed.registerExtension('ack', {
        encoding: messages.Ack,
        onmessage (message, peer) {
          self.onAck(message, peer)
        },
        onerror (err) {
          log('got badly formed ack, ignoring', err)
        }
      })

    }

    this.feed.on('peer-open', (peer) => {
      console.log('peer connected as client', printKey(peer.remotePublicKey))
      const feedKey = self.options.noiseKeyToFeedKey(peer.remotePublicKey)
      console.log('feedKey', printKey(feedKey || ''))
      // TODO emit event to show a connection from this peer
    })
  }

  async onRequest (request, peer) {
    log('Got request', printKey(request.file.sha256), 'queue is ', this.queue.length)
    // metadb.emitWs({ uploadQueue: metadb.uploadQueue })

    if (this.uploading || this.queue.length) {
      this.queue.push({ request, peer })
      // TODO should we allow multiple simultanious uploads? how many?
      // this.sendMessage(QUEUED, messages.Queued.encode({ queuePosition }))
      return
    }
    await this._upload(request, peer)
  }

  async _upload (request, peer) {
    this.uploading = true
    const self = this
    const hash = toString(request.file.sha256)
    const { baseDir, filePath } = await this.options.hashesToFilenames(hash)
    let offset = 0
    // let uploadError

    await new Promise((resolve, reject) => {
      if (!filePath) return reject(new Error('file not found in db'))
      const fullPath = path.join(baseDir, filePath)
      fs.createReadStream(fullPath, { start: request.file.offset }) // end: length?
        .on('data', (data) => {
          self.sendData({
            sha256: request.file.sha256,
            offset,
            data
          }, peer)
          offset += data.length
        })
        .on('end', resolve)
        .on('error', reject)
    }).catch(() => {
      self.extensions.refuse.send({ file: request.file }, peer)
    })

    // this.awaitingAck.add(hash + toString(peer.remotePublicKey))
    // self.emit('uploaded') // , fileObject
    log('Upload complete')
    const to = self.options.noiseKeyToFeedKey(peer.remotePublicKey)
    this.uploadDb.put(`${Date.now()}!${hash}`,
      { name: filePath, to })

    // TODO add timeout
    const next = this.queue.shift()
    if (next) return this._upload(next.request, next.peer)
    this.uploading = false
  }

  onAck (ackMessage, peer) {
    // const deleted = this.awaitingAck.delete(toString(ackMessage.file.sha256) + toString(peer.remotePublicKey))
    log('ack received', ackMessage)
    // if (!deleted) return
    // unblock peer
  }

  onUnrequest (unrequest, peer) {
    log('Got unrequest', unrequest)
    // TODO filter the queue for this request, then emit the new queue
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
