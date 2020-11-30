const SimpleMessageChannels = require('simple-message-channels')
const path = require('path')
const mkdirp = require('mkdirp')
const sodium = require('sodium-native')
const pull = require('pull-stream')
const debug = require('debug')
const messages = require('./messages')
const fs = require('fs')
const EventEmitter = require('events')

// Message types:
const DATA = 0
const REQUEST = 1
const UNREQUEST = 2
const QUEUED = 3
const REFUSE = 4
const HEADER = 5

module.exports = class FileTransfer extends EventEmitter {
  constructor (stream, remotePk, options = {}) {
    super()
    console.log('contrustor called')
    const self = this
    this.remotePk = remotePk
    this.stream = stream
    this.requestQueue = [] // queued requests *FROM* us
    this.requested = {} // pending requests from us
    this.downloadPath = options.downloadPath || '.'
    this.getQueuePosition = options.qetQueuePosition || function () { return 0 }
    this.hashesToFilenames = options.hashesToFilenames

    this.log = options.log || debug('metadb-file-transfer')
    this.transferInfo = (info) => { this.emit('transferInfo', info) }

    // this.ready = false

    this.smc = new SimpleMessageChannels({
      onmessage (channel, type, message) {
        self.log(`Got message type ${type}`)
        switch (type) {
          case DATA:
            self.onData(message)
            break
          case REQUEST:
            self.onRequest(messages.Request.decode(message))
            break
          case UNREQUEST:
            self.onUnrequest(messages.Unrequest.decode(message))
            break
          case REFUSE:
            self.emit('refuse', messages.Refuse.decode(message))
            break
          case HEADER:
            self.onHeader(messages.Header.decode(message))
            break
          case QUEUED:
            self.log('request queued remotely')
            self.emit('queued', messages.Queued.decode(message))
            break
          default:
            self.log('*** Encountered message with unknown type ***')
        }
      }
    })

    stream.on('data', (data) => {
      const success = self.smc.recv(data)
      if (!success) self.log('Error on receive', self.smc.error)
    })

    stream.on('close', self.checkIncompleteDownload)
  }

  // Takes requests objects of the form:
  //   key: hash, value: { offset, length }
  sendRequest (givenRequests) {
    this.log(`REQUEST ${givenRequests}`)
    const self = this
    if (!givenRequests.length) return
    // Check we dont allready have one going - add request to the queue
    if (self.currentDownload) return self.requestQueue.push(givenRequests)

    const request = messages.Request.encode({
      files: givenRequests.map((r) => {
        return {
          sha256: Buffer.from(r.key, 'hex'),
          offset: r.value.offset
          // length: r.value.length
        }
      })
    })

    this.sendMessage(REQUEST, request)
    this.log('request sent!')
    givenRequests.forEach((request) => {
      self.requested[request.key] = request.value
    })
  }

  // Takes requests objects of the form:
  //   key: hash, value: { offset, length }
  cancelRequest (givenRequests) {
    if (!givenRequests.length) return
    // TODO find it in requestQueue and remove

    const unrequest = messages.Unrequest.encode({
      files: givenRequests.map((r) => {
        return {
          sha256: Buffer.from(r.key, 'hex'),
          offset: r.value.offset
          // length: r.value.length
        }
      })
    })

    this.sendMessage(UNREQUEST, unrequest)
  }

  sendMessage (type, message) {
    // Always use channel 0
    this.stream.write(this.smc.send(0, type, message))
  }

  onHeader (header) {
    const self = this
    this.log('got header!', header)
    header.sha256 = header.sha256.toString('hex')
    if (!this.requested[header.sha256]) {
      this.log('header recieved from unexpected hash! - ignoring')
      return
    }

    if (self.currentDownload) {
      this.log('warning: header received before last download finished')
      this.checkIncompleteDownload()
    }

    // Prepare to recieve a file (or part of a file)

    mkdirp(path.join(self.downloadPath, path.dirname(header.filename)), (err) => {
      if (err) throw new Error('Could not create directory')
      self.currentDownload = Object.assign({
        writeStream: fs.createWriteStream(
          path.join(self.downloadPath, header.filename) + '.part',
          { start: header.offset || 0 }
        ),
        bytesReceived: 0,
        hashToCheckInstance: sodium.crypto_hash_sha256_instance()
      }, header)
    })
  }

  onData (dataMessage) {
    this.log('got data!')
    const self = this
    const download = this.currentDownload
    if (!download) {
      this.log('Recieved block without header, ignoring')
      return
    }
    const chunk = dataMessage // .data
    download.writeStream.write(chunk)
    download.bytesReceived += chunk.length
    download.hashToCheckInstance.update(chunk)

    this.log(`[download] ${download.filename} chunk added, ${download.bytesReceived} of ${download.size} (${Math.round(download.bytesReceived / download.size * 100)}%)`)
    this.transferInfo(download)

    if (download.bytesReceived === download.size) {
      this.log(`File ${download.filename} downloaded`)
      download.downloaded = true
      this.transferInfo(download)
      // logObject({ downloadComplete: true })
      const hashToCheck = sodium.sodium_malloc(sodium.crypto_hash_sha256_BYTES)
      download.hashToCheckInstance.final(hashToCheck)
      download.givenHash = hashToCheck.toString('hex')
      // verify hash
      if (download.givenHash === download.sha256) {
        this.log(`Hash for ${download.filename} verified!`)
        download.verified = true
        this.transferInfo(download)
        // TODO destroy write stream?
        // Remove .part suffix
        const fullPath = path.join(self.downloadPath, download.filename)
        fs.rename(fullPath + '.part', fullPath, (err) => {
          if (err) self.log('Cannot rename file!')
          self.emit('verified', download.sha256)
        })
      } else {
        this.log(`Hash for ${download.filename} does not match!`)
        download.cannotVerify = true
        this.transferInfo(download)
      }
      this.emit('downloaded', download)

      delete self.requested[download.sha256]
      delete self.currentDownload
      if (!Object.keys(self.requested).length) {
        // Shift the request off the requestQueue
        const next = self.requestQueue.shift()
        if (next) self.sendRequest(next)
      }
    }
  }

  onRequest (requestMessage) {
    this.log('received request')
    // TODO handle partial file requests
    // TODO respond on err (eg: file not found) - REFUSE
    requestMessage.files = requestMessage.files.map((f) => {
      f.sha256 = f.sha256.toString('hex')
      return f
    })

    const queuePosition = this.getQueuePosition()
    if (queuePosition) {
      // TODO should we allow multiple simultanious uploads? how many?
      this.sendMessage(QUEUED, messages.Queued.encode({ queuePosition }))
      return // err?
    }
    this.emit('request', requestMessage)

    const self = this
    const hashes = requestMessage.files.map(f => f.sha256)
    const missingHashes = []
    pull(
      pull.values(hashes),
      pull.asyncMap(self.hashesToFilenames),
      pull.map(fileObject => {
        if (fileObject.notFound) {
          missingHashes.push(fileObject.notFound)
          return false
        }
        return fileObject
      }),
      pull.filter(Boolean),
      pull.asyncMap((fileObject, cb) => {
        const fullPath = path.join(fileObject.baseDir, fileObject.filePath)
        fs.stat(fullPath, (err, statObj) => {
          if (err) {
            missingHashes.push(fileObject.hash)
            return cb(null, false)
          }
          cb(null, Object.assign(fileObject, {
            size: statObj.size,
            bytesSent: 0
            // TODO -could also include permissions etc.
          }))
        })
      }),
      pull.filter(Boolean),
      pull.asyncMap((fileObject, cb) => {
        self.log('sending header')
        self.sendMessage(HEADER, messages.Header.encode({
          filename: fileObject.filePath,
          size: fileObject.size,
          sha256: Buffer.from(fileObject.hash, 'hex')
          // offset TODO (get from request)
        }))

        const fullPath = path.join(fileObject.baseDir, fileObject.filePath)
        const source = fs.createReadStream(fullPath) // TODO offset
        source.on('data', (data) => {
          self.sendMessage(DATA, data)
          self.log(`upload block for filestream ${fileObject.filePath}`)
          fileObject.bytesSent += data.length
          self.transferInfo({ upload: fileObject })
        })
        source.on('end', () => { // TODO close?
          self.emit('uploaded', fileObject)
          cb()
        })
        source.on('error', (err) => { throw err })
      }),
      pull.drain(() => {}, (err) => {
        if (err) throw err // TODO
        if (missingHashes.length) {
          self.sendMessage(REFUSE, messages.Refuse.encode({
            files: missingHashes.map(hash => {
              return { sha256: Buffer.from(hash, 'hex') }
            })
          }))
        }
        // self.sendMessage(FINISH, Buffer.from(''))
        self.log('FINISH UPLOAD')
        self.emit('requestComplete')
      })
    )
  }

  onUnrequest (unrequestMessage) {
    this.emit('unrequest', unrequestMessage.files.map(f => f.sha256.toString('hex')))
    // TODO how to check if it is the target right now?
    // if it is can we just destroy target?
  }

  checkIncompleteDownload () {
    const download = this.currentDownload
    if (download && (download.bytesReceived < download.size)) {
      this.emit('incomplete', download)
    }
  }
}
// function logEvents (emitter, name) {
//   let emit = emitter.emit
//   name = name ? `(${name}) ` : ''
//   emitter.emit = (...args) => {
//     console.log(`\x1b[33m${args[0]}\x1b[0m`, util.inspect(args.slice(1), { depth: 1, colors: true }))
//     emit.apply(emitter, args)
//   }
// }
