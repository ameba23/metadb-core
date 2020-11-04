const SimpleMessageChannels = require('simple-message-channels')
const tar = require('tar-fs')
const path = require('path')
const sodium = require('sodium-native')
const pullLevel = require('pull-level')
const pull = require('pull-stream')
const log = require('debug')('metadb-file-transfer')
const messages = require('./messages')
const OwnFilesFromHashes = require('../queries/own-files-from-hashes')
const { XOR } = require('../crypto')

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
      this.remotePk = stream.cryptoParams.remotePk
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
            case FINISH:
              if (self.target && !self.target.destroyed) self.target.end()
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

      const { nonces, encryptionKeySplit } = stream.cryptoParams
      stream.cryptoParams.encryption = new XOR(nonces, encryptionKeySplit)
      stream.on('data', (data) => {
        log('Got data!')
        const success = self.smc.recv(stream.cryptoParams.encryption.decrypt(data))
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
      if (this.target) log(`target destroyed? ${this.target.destroyed}`)
      if (this.target && !this.target.destroyed) return this.requestQueue.push(givenRequests)

      const request = messages.Request.encode({
        files: givenRequests.map((r) => {
          return {
            hash: Buffer.from(r.key, 'hex'),
            start: r.value.start,
            end: r.value.end
          }
        })
      })

      const success = this.sendMessage(REQUEST, request)
      if (!success) return // TODO

      // Prepare to receive a response
      const verifiedHashes = []
      const hashes = givenRequests.map(r => r.key.toString('hex'))
      const badHashes = []
      function logObject (object) {
        metadb.emitWs({ download: object })
      }

      this.target = tar.extract(metadb.config.downloadPath, {
        // map: function (header) {
        //   header.name = header.name + '.part'
        //   return header
        // },
        mapStream: function (fileStream, header) {
          const name = header.name
          log('[tar] ', name)

          const fileObject = {}
          fileObject[name] = {
            bytesRecieved: 0,
            size: header.size,
            hashToCheckInstance: sodium.crypto_hash_sha256_instance()
          }

          fileStream.on('data', (chunk) => {
            // const name = header.name.slice(0, -5)
            log(`[tar] read block for filestream ${name}`)
            fileObject[name].bytesRecieved += chunk.length

            fileObject[name].hashToCheckInstance.update(chunk)

            log(`[download] ${name} chunk added, ${fileObject[name].bytesRecieved} of ${header.size} (${Math.round(fileObject[name].bytesRecieved / header.size * 100)}%) `)
            logObject(fileObject)

            if (fileObject[name].bytesRecieved === header.size) {
              log(`File ${name} downloaded`)
              fileObject[name].downloaded = true
              logObject(fileObject)
              logObject({ downloadComplete: true })
              const hashToCheck = sodium.sodium_malloc(sodium.crypto_hash_sha256_BYTES)
              fileObject[name].hashToCheckInstance.final(hashToCheck)
              fileObject[name].hash = hashToCheck.toString('hex')
              // verify hash
              if (hashes.includes(fileObject[name].hash)) {
                log(`Hash for ${header.name} verified!`)
                fileObject[name].verified = true
                logObject(fileObject)
                verifiedHashes.push(hashToCheck.toString('hex'))

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
          })
          return fileStream
        }
      })

      this.target.on('finish', () => {
        log('[download] tar stream finished')
        if ((verifiedHashes.length + badHashes.length) === hashes.length) {
          log('[download] expected number of files recieved')
        } else {
          log('[download] tar stream ended, and not enough files present')
        }

        if (verifiedHashes.length === hashes.length) {
          log('[download] all files hashes match!')
        }
        self.target.destroy()
        self.target = false
        // Shift the request off the requestQueue
        const next = self.requestQueue.shift()
        if (next) self.sendRequest(next)
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
            hash: Buffer.from(r.key, 'hex'),
            start: r.value.start,
            end: r.value.end
          }
        })
      })

      this.sendMessage(UNREQUEST, unrequest)
    }

    sendMessage (type, message) {
      log('Writing...')
      const streamToUse = this.streams.find(s => !s.destroyed)
      if (!streamToUse) return false // TODO what to do here
      // Always use channel 0
      streamToUse.write(streamToUse.cryptoParams.encryption.encrypt(this.smc.send(0, type, message)))
      return true
    }

    onData (data) {
      if (this.target && !this.target.destroyed) return this.target.write(data)
      // TODO what to do otherwise? tell them to stop?
      log('Warning: data recieved, but no target stream open')
    }

    onRequest (requestMessage) {
      // TODO handle partial file requests
      // TODO respond on err (eg: file not found) - REFUSE
      requestMessage.files = requestMessage.files.map((f) => {
        f.hash = f.hash.toString('hex')
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
      const hashes = requestMessage.files.map(f => f.hash)
      OwnFilesFromHashes(metadb)(hashes, (err, fileObjects) => {
        if (err) {
          log('Error retrieving filenames')
          return // TODO REFUSE
        }

        const notFound = fileObjects.filter(f => f.notFound)
        if (notFound.length) {
          self.sendMessage(REFUSE, messages.Refuse.encode({
            files: notFound.map(hash => {
              return { hash: Buffer.from(hash, 'hex') }
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
          return (!unrequestMessage.files.map(f => f.hash.toString('hex')).includes(file.hash.toString('hex')))
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
