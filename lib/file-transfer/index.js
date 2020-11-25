const SimpleMessageChannels = require('simple-message-channels')
const path = require('path')
const sodium = require('sodium-native')
const pullLevel = require('pull-level')
const pull = require('pull-stream')
const debug = require('debug')
const messages = require('./messages')
const fs = require('fs')

// Message types:
const DATA = 0
const REQUEST = 1
const UNREQUEST = 2
const QUEUED = 3
const REFUSE = 4
const HEADER = 5

module.exports = function (metadb) {
  const log = debug(`metadb-file-transfer ${metadb.keyHex.slice(0, 4)}`)
  class FileTransfer {
    constructor (stream) {
      console.log('contrustor called')
      const self = this
      this.remotePk = stream.remotePk
      this.stream = stream
      this.requestQueue = [] // queued requests *FROM* us
      this.requested = {} // pending requests from us

      // this.ready = false

      this.smc = new SimpleMessageChannels({
        onmessage (channel, type, message) {
          log(`Got message type ${type}`)
          switch (type) {
            case DATA:
              // self.onData(messages.Data.decode(message))
              self.onData(message)
              break
            case REQUEST:
              self.onRequest(messages.Request.decode(message))
              break
            case UNREQUEST:
              self.onUnrequest(messages.Unrequest.decode(message))
              break
            case REFUSE:
              // TODO send something on ws?
              break
            case HEADER:
              self.onHeader(messages.Header.decode(message))
              break
            default:
              log('*** Encountered message with unknown type ***')
          }
        }
      })

      stream.on('data', (data) => {
        log('******************************************Got data!')
        const success = self.smc.recv(data)
        if (!success) log('Error on receive')
      })
      this.onReady()
    }

    onReady () {
      // this.ready = true

      const self = this
      // if we already have pending requests, send them
      console.log('*******ready called')
      const next = this.requestQueue.shift()
      console.log('next:', next)
      if (next) this.sendRequest(next)

      // Check our requests db for open requests for this peer,
      // and send them as a batch
      pull(
        pullLevel.read(metadb.requestsdb, { live: false }),
        pull.asyncMap((entry, cb) => {
          console.log('*********************************fond one!')
          metadb.files.get(entry.key, (err, metadata) => {
            if (!err && metadata.holders.includes(self.remotePk.toString('hex'))) {
              // if (entry.value.open === true) TODO
              cb(null, entry)
            }
          })
        }),
        pull.collect((err, entries) => {
          if (err) throw err // TODO
          log(`Requesting ${entries.length} existing entries in wishlist`)
          if (entries.length) self.sendRequest(entries)
        })
      )
    }

    // Takes requests objects of the form:
    //   key: hash, value: { start, end }
    sendRequest (givenRequests) {
      log(`REQUEST ${givenRequests}`)
      const self = this
      if (!givenRequests.length) return
      // Check we dont allready have one going - add request to the queue
      if (self.currentDownload) return self.requestQueue.push(givenRequests)

      const request = messages.Request.encode({
        files: givenRequests.map((r) => {
          return {
            sha256: Buffer.from(r.key, 'hex'),
            start: r.value.start,
            end: r.value.end
          }
        })
      })

      const success = this.sendMessage(REQUEST, request)
      if (!success) return // TODO
      log('request sent!')
      givenRequests.forEach((request) => {
        self.requested[request.key] = request.value
      })
    }

    // Takes requests objects of the form:
    //   key: hash, value: { start, end }
    cancelRequest (givenRequests) {
      if (!givenRequests.length) return
      // TODO find it in requestQueue and remove

      const unrequest = messages.Unrequest.encode({
        files: givenRequests.map((r) => {
          return {
            sha256: Buffer.from(r.key, 'hex'),
            start: r.value.start,
            end: r.value.end
          }
        })
      })

      this.sendMessage(UNREQUEST, unrequest)
    }

    sendMessage (type, message) {
      // Always use channel 0
      this.stream.write(this.smc.send(0, type, message))
      return true
    }

    onHeader (header) {
      log('got header!')
      // Prepare to recieve a file (or part of a file)
      // if (!this.downloads[hash]) {
      //   log('chunk recieved from unexpected hash!')
      //   return
      // }
      header.sha256 = header.sha256.toString('hex')
      // TODO: check dont allready have a download open!?
      this.currentDownload = Object.assign({
        writeStream: fs.createWriteStream(
          path.join(metadb.config.downloadPath, header.filename) + '.part',
          { start: header.offset || 0 }
        ),
        bytesReceived: 0,
        hashToCheckInstance: sodium.crypto_hash_sha256_instance()
      }, header)
      log(`Got header ${header}`)
    }

    onData (dataMessage) {
      log(`got data!`)
      const self = this
      const download = this.currentDownload
      if (!download) {
        log('Recieved block without header, ignoring')
        return
      }
      const chunk = dataMessage.data
      download.writeStream.write(chunk)
      download.bytesReceived += chunk.length
      download.hashToCheckInstance.update(chunk)

      function logObject (object) {
        metadb.emitWs({ download: object })
      }

      log(`[download] ${download.filename} chunk added, ${download.bytesRecieved} of ${download.size} (${Math.round(download.bytesRecieved / download.size * 100)}%) `)
      // logObject(this.downloads)
      logObject(download)

      if (download.bytesRecieved === download.size) {
        log(`File ${download.filename} downloaded`)
        download.downloaded = true
        logObject(download)
        // logObject({ downloadComplete: true })
        const hashToCheck = sodium.sodium_malloc(sodium.crypto_hash_sha256_BYTES)
        download.hashToCheckInstance.final(hashToCheck)
        download.givenHash = hashToCheck.toString('hex')
        // verify hash
        if (download.givenHash === download.sha256) {
          log(`Hash for ${download.filename} verified!`)
          download.verified = true
          logObject(download)
          // TODO destroy write stream?
                // TODO Remove .part suffix
                // fs.rename(name + '.part', name, (err) => {})

          // Remove this request from our local db
          metadb.requestsdb.del(download.sha256, (err) => {
            if (err) console.log(err)
            log('Deleted entry from wishlist')
          })
          // or rather metadb.requestsdb.put(hash, {closed:true})
        } else {
          log(`Hash for ${download.filename} does not match!`)
          download.cannotVerify = true
          logObject(download)
        }
        metadb.downloadeddb.put(
          `${Date.now()}!${download.sha256}`,
          {
            name: download.filename,
            from: this.remotePk.toString('hex'),
            verified: download.verified
          },
          (err) => {
            if (err) console.log(err)
            log('Added entry to downloadeddb')

            delete self.requested[download.sha256]
            delete self.currentDownload
            if (!Object.keys(self.requested).length) {
              // Shift the request off the requestQueue
              const next = self.requestQueue.shift()
              if (next) self.sendRequest(next)
            }
          }
        )
      }
    }

    onRequest (requestMessage) {
      log('received request')
      // TODO handle partial file requests
      // TODO respond on err (eg: file not found) - REFUSE
      requestMessage.files = requestMessage.files.map((f) => {
        f.sha256 = f.sha256.toString('hex')
        return f
      })
      metadb.uploadQueue.push({ sender: this.remotePk, requestMessage })
      metadb.emitWs({ uploadQueue: metadb.uploadQueue })

      if (metadb.uploadQueue.length > 1) {
        // TODO should we allow multiple simultanious uploads? how many?
        this.sendMessage(QUEUED, messages.Queued.encode({ queuePosition: metadb.uploadQueue.length }))
        return // err?
      }
      function logObject (object) {
        metadb.emitWs({ upload: object })
      }

      const self = this
      const hashes = requestMessage.files.map(f => f.sha256)
      const missingHashes = []
      pull(
        pull.values(hashes),
        pull.asyncMap((hash, cb) => {
          metadb.sharedb.get(hash, (err, fileObject) => {
            if (err) {
              missingHashes.push(hash)
              return cb(null, false)
            }
            cb(null, Object.assign(fileObject, { hash }))
          })
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
          log('sending header')
          const success = self.sendMessage(HEADER, messages.Header.encode({
            filename: fileObject.filePath,
            size: fileObject.size,
            sha256: Buffer.from(fileObject.hash, 'hex')
            // offset TODO (get from request)
          }))
          if (!success) return cb(new Error('cannot send header'))

          const fullPath = path.join(fileObject.baseDir, fileObject.filePath)
          const source = fs.createReadStream(fullPath) // TODO offset
          source.on('data', (data) => {
            const success = self.sendMessage(DATA, data)
            if (!success) return cb(new Error('cannot send data'))
            log(`upload block for filestream ${fileObject.filePath}`)
            fileObject.bytesSent += data.length
            logObject(fileObject)
          })
          source.on('end', () => { // TODO close?
            metadb.uploaddb.put(`${Date.now()}!${fileObject.hash}`,
              { name: fileObject.filePath, to: self.remotePk.toString('hex') },
              (err) => {
                if (err) console.log(err)
                log('Added entry to uploaddb')
              }
            )
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
          log('Sending FINISH signal')
          // self.sendMessage(FINISH, Buffer.from(''))
          log('FINISH UPLOAD')
          metadb.uploadQueue.shift()
          metadb.emitWs({ uploadQueue: metadb.uploadQueue })
          if (metadb.uploadQueue.length && metadb.connectedPeers[metadb.uploadQueue[0].remotePk]) {
            const next = metadb.uploadQueue[0]
            metadb.connectedPeers[next.remotePk].onRequest(next.requestMessage)
          }
        })
      )
    }

    onUnrequest (unrequestMessage) {
      const self = this
      // TODO double check this:
      metadb.uploadQueue = metadb.uploadQueue.map((item) => {
        if (item.sender.toString('hex') !== self.remotePk.toString('hex')) return item
        item.requestMessage.files = item.requestMessage.files.filter((file) => {
          return (!unrequestMessage.files.map(f => f.sha256.toString('hex')).includes(file.sha256.toString('hex')))
        })
      })
      metadb.emitWs({ uploadQueue: metadb.uploadQueue })
      // TODO how to check if it is the target right now?
      // if it is can we just destroy target?
    }
  }

  return function (...args) {
    return new FileTransfer(...args)
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
