const fs = require('fs')
const path = require('path')
const messages = require('./messages')
const { printKey, toString } = require('../util')

// Manage uploads - one instance for all connected peers

module.exports = class Server {
  constructor (feed, handlers) {
    this.feed = feed
    this.handlers = handlers
    this.queue = []
    const self = this
    this.extensions = {
      request: this.feed.registerExtension('request', {
        encoding: messages.Request,
        onmessage (message, peer) {
          self.onRequest(message, peer)
        },
        onerror (err) {
          console.log('got badly formed req, ignoring', err)
        }
      }),
      data: this.feed.registerExtension('data', { encoding: messages.Data }),
      refuse: this.feed.registerExtension('refuse', { encoding: messages.Refuse })
    }

    this.feed.on('peer-open', (p) => {
      console.log('peer connected as client', printKey(p.remotePublicKey))
    })
  }

  async onRequest (request, peer) {
    // metadb.emitWs({ uploadQueue: metadb.uploadQueue })

    if (this.queue.length) {
      this.queue.push({ request, peer })
      // TODO should we allow multiple simultanious uploads? how many?
      // this.sendMessage(QUEUED, messages.Queued.encode({ queuePosition }))
      return // err?
    }
    await this._upload(request, peer)
  }

  async _upload (request, peer) {
    const self = this
    const { baseDir, filePath } = await this.handlers.hashesToFilenames(toString(request.file.sha256))
    let offset = 0
    let uploadError

    await new Promise((resolve, reject) => {
      if (!filePath) reject(new Error('file not found in db'))
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
    
    // self.emit('uploaded') // , fileObject
    console.log('upload complete')
    const next = self.queue.shift()
    if (next) self._upload(next.request, next.peer)
  }

  onUnrequest (unrequest, peer) {
    // TODO filter the queue for this request, then emit the new queue
  }

  sendData (dataMsg, peer) {
    this.extensions.data.send(dataMsg, peer)
  }
}
