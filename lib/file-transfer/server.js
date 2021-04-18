const path = require('path')
const speedometer = require('speedometer')
const raf = require('random-access-file')
const messages = require('./messages')
const { printKey, toString } = require('../util')
const crypto = require('../crypto')
const { EventEmitter } = require('events')
const log = require('debug')('metadb-server')

// TODO optimise these constants
const CHUNK_SIZE = 64 * 1024
const MAX_BUFFER_SIZE = CHUNK_SIZE * 10
const BUFFER_WAIT_TIME = 10

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
      const feedKey = self.options.noiseKeyToFeedKey(peer.remotePublicKey)
      log(`Peer connected as client noisekey: ${printKey(peer.remotePublicKey)} feed key: ${printKey(feedKey || '')}`)
      // TODO emit event to show a connection from this peer
    })
  }

  async onRequest (request, peer) {
    log(`Got request ${printKey(request.file.sha256)} queue has ${this.queue.length} items`)
    const { baseDir, filePath } = await this.options.hashesToFilenames(toString(request.file.sha256))
    if (!filePath) throw new Error('file not found in db')
    request.baseDir = baseDir
    request.filePath = filePath
    if (this.uploading || this.queue.length) {
      const existsInQueue = this.queue.find((i) => {
        if (Buffer.compare(i.request.file.sha256, request.file.sha256) !== 0) return false
        return (Buffer.compare(i.peer.remotePublicKey, peer.remotePublicKey) === 0)
      })
      if (existsInQueue) return
      this.queue.push({ request, peer })
      this.logUploadQueue()
      // TODO should we allow multiple simultanious uploads? how many?
      // this.sendMessage(QUEUED, messages.Queued.encode({ queuePosition }))
      return
    }
    await this._upload(request, peer)
  }

  async _upload (request, peer) {
    // logEvents(peer.stream.stream)
    const self = this
    const hash = toString(request.file.sha256)
    this.uploading = hash
    const fullPath = path.join(request.baseDir, request.filePath)
    const to = self.options.noiseKeyToFeedKey(peer.remotePublicKey)
    let uploadError

    const speed = speedometer()
    const file = raf(fullPath, { writeable: false })
    const size = await new Promise((resolve, reject) => {
      file.stat((err, stat) => {
        if (err) return reject(err)
        resolve(stat.size)
      })
    }).catch((err) => {
      self.extensions.refuse.send({ file: request.file }, peer)
      log(`Error on reading file ${request.filePath} ${err}`)
      uploadError = err.message
    })

    for await (const { data, offset } of getChunksFromFile(file, size, request.file.offset)) {
      self.sendData({
        sha256: request.file.sha256,
        offset,
        data
      }, peer)
      const kbps = parseInt(speed(data.length) * 0.008)

      self.emit('upload', {
        sha256: hash,
        filename: fullPath,
        size,
        bytesSent: offset,
        to,
        kbps
      })

      // console.log(' **** read buffered ', peer.stream.stream._readableState.buffered)
      while (peer.stream.stream._readableState.buffered > MAX_BUFFER_SIZE) {
        await new Promise((resolve) => { setTimeout(resolve, BUFFER_WAIT_TIME) })
        // await new Promise((resolve) => { process.nextTick(resolve) })
      }
    }
    file.close()

    this.awaitingAck.add(hash + toString(peer.remotePublicKey))
    this.emit('uploaded', { sha256: hash, filename: fullPath, to, error: uploadError }) // , fileObject
    log('Upload complete')

    if (!uploadError) this.uploadDb.put(`${Date.now()}!${hash}`, { filename: request.filePath, to })

    const next = this.queue.shift()
    this.logUploadQueue()

    if (next) {
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

    async function * getChunksFromFile (file, size, initialOffset) {
      let offset = initialOffset || 0
      while (offset < size) {
        const blockSize = Math.min(CHUNK_SIZE, size - offset)
        // TODO could re-use buffer
        const data = await new Promise((resolve, reject) => {
          file.read(offset, blockSize, (err, data) => {
            if (err) return reject(err)
            resolve(data)
          })
        })
        yield { data, offset }
        offset += blockSize
      }
    }
  }

  logUploadQueue () {
    const self = this
    this.emit('uploadQueue', this.queue.map(item => {
      return {
        sha256: toString(item.request.file.sha256),
        length: item.request.file.length,
        offset: item.request.file.offset,
        baseDir: item.request.baseDir,
        filePath: item.request.filePath,
        // TODO store 'to' with the request
        to: self.options.noiseKeyToFeedKey(item.peer.remotePublicKey)
      }
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
    // TODO this wont work - use buffer.compare:
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
// function logEvents (emitter, name) {
//   const emit = emitter.emit
//   name = name ? `(${name}) ` : ''
//   emitter.emit = (...args) => {
//     console.log(`\x1b[33m    ----${args[0]}\x1b[0m`)
//     emit.apply(emitter, args)
//   }
// }
