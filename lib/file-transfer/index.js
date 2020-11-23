const SimpleMessageChannels = require('simple-message-channels')
const tar = require('tar-fs')
const path = require('path')
const sodium = require('sodium-native')
const pullLevel = require('pull-level')
const pull = require('pull-stream')
const log = require('debug')('metadb-file-transfer')
const messages = require('./messages')
const OwnFilesFromHashes = require('../queries/own-files-from-hashes')

// Message types:
const DATA = 0
const REQUEST = 1
const UNREQUEST = 2
const QUEUED = 3
const REFUSE = 4
const FINISH = 5

module.exports = function (metadb) {
  class FileTransfer {
    constructor (stream) {
      const self = this
      this.remotePk = stream.remotePk
      this.streams = []
      this.addStream(stream)
      this.requestQueue = [] // pending requests *FROM* us
      this.connected = true

      // this.ready = false

      this.smc = new SimpleMessageChannels({
        onmessage (channel, type, message) {
          log(`Got message type ${type}`)
          switch (type) {
            case DATA:
              self.onData(messages.Data.decode(message))
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
            case ACK:
              // if (self.target && !self.target.destroyed) self.target.end()
              break
            default:
              log('*** Encountered message with unknown type ***')
          }
        }
      })
      this.onReady()
    }

    onReady () {
      this.ready = true

      const self = this

      // Check our requests db for open requests for this peer,
      // and send them as a batch
      pull(
        pullLevel.read(metadb.requestsdb, { live: false }),
        pull.asyncMap((entry, cb) => {
          metadb.files.get(entry.key, (err, metadata) => {
            if (!err && metadata.holders.includes(self.remotePk.toString('hex'))) {
              // if (entry.value.open === true) TODO
              cb(null, entry)
            }
          })
        }),
        pull.collect((err, entries) => {
          if (err) throw err // TODO
          log(`Requesting ${entries.length}`)
          if (entries.length) self.sendRequest(entries)
        })
      )
    }

    addStream (stream) {
      log(`addstream called. ${stream.destroyed}`)
      const self = this
      stream.on('close', () => {
        log('stream closed!')
        if (self.streams.every(s => s.destroyed)) {
          log('All streams from peer are destroyed')
          self.connected = false
          if (self.remotePk) delete metadb.connectedPeers[self.remotePk.toString('hex')]
          metadb.emitWs({ connectedPeers: Object.keys(metadb.connectedPeers) })
        }
      })

      stream.on('data', (data) => {
        // log('Got data!')
        const success = self.smc.recv(data)
        if (!success) log('Error on receive')
      })
      this.streams.push(stream)
    }

    // Takes requests objects of the form:
    //   key: hash, value: { start, end }
    sendRequest (givenRequests) {
      log(`sending REQUEST ${givenRequests}`)
      const self = this
      if (!givenRequests.length) return
      // Check we dont allready have one going - if (target) add request to the queue
      if (Object.keys(self.downloads).length) return this.requestQueue.push(givenRequests)

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

      givenRequests.forEach((request) => {
        self.downloads[request.key] = {
          bytesRecieved: 0,
          hashToCheckInstance: sodium.crypto_hash_sha256_instance()
        }
      })


      // metadb.config.downloadPath


        // Shift the request off the requestQueue
        // const next = self.requestQueue.shift()
        // if (next) self.sendRequest(next)
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
      // log('Writing...')
      const streamToUse = this.streams.find(s => !s.destroyed)
      if (!streamToUse) return false // TODO what to do here
      // Always use channel 0
      streamToUse.write(this.smc.send(0, type, message))
      return true
    }

    onData (dataMessage) {
      const hash = dataMessage.sha256.toString('hex')
      const chunk = dataMessage.data
      if (!this.downloads[hash]) {
        log('chunk recieved from unexpected hash!')
        return
      }
      if (dataMessage.filename && !this.downloads[hash].filename) this.downloads[hash].filename = dataMessage.filename
      if (!this.downloads[hash].filename) {
        return log('filename not given') // look it up?
      }
      if (!this.downloads[hash].writeStream) {
        this.downloads[hash].writeStream = fs.createWriteStream(
          path.join(metadb.config.downloadPath, this.downloads[hash].filename) + '.part',
          { start: dataMessage.offset || 0 }
        )
      }
      this.downloads[hash].writeStream.write(chunk)

      function logObject (object) {
        metadb.emitWs({ download: object })
      }

      log(`received block for filestream`)
      this.downloads[hash].bytesRecieved += chunk.length

      this.downloads[hash].hashToCheckInstance.update(chunk)

      log(`[download] ${this.downloads[hash].filename} chunk added, ${this.downloads[hash].bytesRecieved} of ${this.downloads[hash].size} (${Math.round(this.downloads[hash].bytesRecieved / this.downloads[hash].size * 100)}%) `)
      logObject(this.downloads)

      if (this.downloads[hash].bytesRecieved === this.downloads[hash].size) {
        log(`File ${this.downloads[hash].name} downloaded`)
        this.downloads[hash].downloaded = true
        logObject(this.downloads)
        logObject({ downloadComplete: true })
        const hashToCheck = sodium.sodium_malloc(sodium.crypto_hash_sha256_BYTES)
        this.downloads[hash].hashToCheckInstance.final(hashToCheck)
        this.downloads[hash].givenHash = hashToCheck.toString('hex')
        // verify hash
        if (this.downloads[hash].givenHash === hash) {
          log(`Hash for ${header.name} verified!`)
          this.downloads[hash].verified = true
          logObject(this.downloads)
// TODO destroy write stream?
                // TODO Remove .part suffix
                // fs.rename(name + '.part', name, (err) => {})

                // Remove this request from our local db
                metadb.requestsdb.del(hashToCheck.toString('hex'), (err) => {
                  if (err) console.log(err)
                  log('Deleted entry from wishlist')
                })
                // or rather metadb.requestsdb.put(hash, {closed:true})
              } else {
                log(`Hash for ${header.name} does not match!`)
                fileObject[name].cannotVerify = true
                logObject(fileObject)
                badHashes.push(hashToCheck)
              }
              metadb.downloadeddb.put(
                `${Date.now()}!${hashToCheck.toString('hex')}`,
                { name, from: self.remotePk.toString('hex'), verified: fileObject[name].verified },
                (err) => {
                  if (err) console.log(err)
                  log('Added entry to downloadeddb')
                }
              )
            }
      // if (this.target && !this.target.destroyed) return this.target.write(data)
      // TODO what to do otherwise? tell them to stop?
      log('Warning: data recieved, but no target stream open')
    }

    onRequest (requestMessage) {
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

      const self = this
      const hashes = requestMessage.files.map(f => f.sha256)
      OwnFilesFromHashes(metadb)(hashes, (err, fileObjects) => {
        if (err) {
          log('Error retrieving filenames')
          return // TODO REFUSE
        }

        const notFound = fileObjects.filter(f => f.notFound)
        if (notFound.length) {
          self.sendMessage(REFUSE, messages.Refuse.encode({
            files: notFound.map(hash => {
              return { sha256: Buffer.from(hash, 'hex') }
            })
          }))
        }

        const entries = fileObjects
          .filter(f => !f.notFound)
          .map(f => path.join(f.baseDir, f.filePath))

        if (!entries.length) finishUpload()

        function logObject (object) {
          metadb.emitWs({ upload: object })
        }

        // TODO check if specifying 'entries' is slowing things down
        const input = tar.pack('/', {
          entries,
          map: function (header) {
            // Remove the private part of the path name
            const fileObject = fileObjects.find(f => path.join(f.baseDir, f.filePath) === header.name)
            header.name = fileObject.filePath

            // Include the hash in the header
            header.sha256 = fileObject.hash
            return header
          },

          mapStream: function (fileStream, header) {
            log('[tar-upload] ', header.name)
            const hash = header.sha256

            const fileObject = {}
            fileObject[hash] = {
              name: header.name,
              size: header.size,
              bytesSent: 0
            }

            fileStream.on('data', (chunk) => {
              log(`[tar] upload block for filestream ${header.name}`)
              fileObject[hash].bytesSent += chunk.length

              logObject(fileObject)

              if (fileObject[hash].bytesSent === header.size) {
                metadb.uploaddb.put(`${Date.now()}!${hash}`,
                  { name: header.name, to: self.remotePk.toString('hex') },
                  (err) => {
                    if (err) console.log(err)
                    log('Added entry to uploaddb')
                  }
                )
              }
            })
            return fileStream
          }
        })
        input.on('data', (data) => {
          self.sendMessage(DATA, data)
        })
        input.on('error', (err) => {
          throw err // TODO
        })
        input.on('end', () => {
          log('Sending FINISH signal')
          self.sendMessage(FINISH, Buffer.from(''))
          finishUpload()
        })

        function finishUpload () {
          log('FINISH UPLOAD')
          metadb.uploadQueue.shift()
          metadb.emitWs({ uploadQueue: metadb.uploadQueue })
          if (metadb.uploadQueue.length && metadb.connectedPeers[metadb.uploadQueue[0].remotePk]) {
            const next = metadb.uploadQueue[0]
            metadb.connectedPeers[next.remotePk].onRequest(next.requestMessage)
          }
        }
      })
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
