const SimpleMessageChannels = require('simple-message-channels')
const tar = require('tar-fs')
const path = require('path')
const sodium = require('sodium-native')
const pullLevel = require('pull-level')
const pull = require('pull-stream')
const log = console.log
const util = require('util')
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
      this.remotePk = stream.cryptoParams.remotePk
      this.streams = []
      this.addStream(stream)
      this.requestQueue = [] // pending requests *FROM* us
      this.connected = true

      // this.ready = false

      this.smc = new SimpleMessageChannels({
        onmessage (channel, type, message) {
          console.log('got message type', type)
          switch (type) {
            case DATA:
              // this.onData(messages.Data.decode(message))
              // console.log('chunk:', message.toString())
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
              // unknown type
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
          console.log('requesting ', entries.length)
          if (entries.length) self.sendRequest(entries)
        })
      )
    }

    addStream (stream) {
      console.log('addstream called', stream.destroyed)
      const self = this
      stream.on('close', () => {
        console.log('stream closed!', stream.destroyed)
        if (self.streams.every(s => s.destroyed)) {
          console.log('All streams from peer are destroyed')
          self.connected = false
        }
      })

      const { nonces, encryptionKeySplit } = stream.cryptoParams
      stream.cryptoParams.encryption = new XOR(nonces, encryptionKeySplit)
      stream.on('data', (data) => {
        console.log('Got data!')
        const success = self.smc.recv(stream.cryptoParams.encryption.decrypt(data))
        if (!success) log('Error on receive')
      })
      this.streams.push(stream)
    }

    // Takes requests objects of the form:
    //   key: hash, value: { start, end }
    sendRequest (givenRequests) {
      console.log('sending REQUEST', givenRequests)
      const self = this
      if (!givenRequests.length) return
      // Check we dont allready have one going - if (target) add request to the queue
      if (this.target)console.log('target destroyed? ', this.target.destroyed)
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
      this.sendMessage(REQUEST, request)

      // Prepare to receive a response
      const files = {}
      const verifiedHashes = []
      const hashes = givenRequests.map(r => r.key.toString('hex'))
      const badHashes = []
      function logObject (object) {
        metadb.emitWs({ download: object })
      }

      this.target = tar.extract(metadb.config.downloadPath, {
        mapStream: function (fileStream, header) {
          log('[tar] ', header.name)
          fileStream.on('data', (chunk) => {
            const name = header.name
            log(`[tar] read block for filestream ${name}`)
            files[name] = files[name] || {}
            files[name].bytesRecieved = files[name].bytesRecieved || 0
            files[name].bytesRecieved += chunk.length

            files[name].hashToCheckInstance = files[name].hashToCheckInstance || sodium.crypto_hash_sha256_instance()
            files[name].hashToCheckInstance.update(chunk)

            files[name].blocksRecieved = files[name].blocksRecieved || 0
            log(`[download] ${name} chunk ${files[name].blocksRecieved} added, ${files[name].bytesRecieved} of ${header.size} (${Math.round(files[name].bytesRecieved / header.size * 100)}%) `)
            files[name].size = header.size
            logObject(files)
            files[name].blocksRecieved += 1

            if (files[name].bytesRecieved === header.size) {
              log(`File ${name} downloaded`)
              files[name].downloaded = true
              logObject(files)
              const hashToCheck = sodium.sodium_malloc(sodium.crypto_hash_sha256_BYTES)
              files[name].hashToCheckInstance.final(hashToCheck)
              // verify hash
              if (hashes.includes(hashToCheck.toString('hex'))) {
                log(`Hash for ${header.name} verified!`)
                files[name].verified = true
                logObject(files)
                verifiedHashes.push(hashToCheck.toString('hex'))

                // Remove this request from our local db
                metadb.requestsdb.del(hashToCheck.toString('hex'), (err) => {
                  if (err) console.log(err)
                  console.log('Deleted entry from wishlist')
                })
                metadb.downloadeddb.put(hashToCheck.toString('hex'), name, (err) => {
                  if (err) console.log(err)
                  console.log('Added entry to downloadeddb')
                })
                // or rather metadb.requestsdb.put(hash, {closed:true})
              } else {
                log(`Hash for ${header.name} does not match!`)
                files[name].cannotVerify = true
                logObject(files)
                badHashes.push(hashToCheck)
              }
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
      console.log('writing...')
      // Always use channel 0
      const streamToUse = this.streams.find(s => !s.destroyed)
      streamToUse.write(streamToUse.cryptoParams.encryption.encrypt(this.smc.send(0, type, message)))
    }

    onData (data) {
      if (this.target && !this.target.destroyed) return this.target.write(data)
      // TODO what to do otherwise? tell them to stop?
      log('Warning: data recieved, but no target stream open')
    }

    onRequest (requestMessage) { // TODO why a callback?
      // TODO handle partial file requests
      // TODO handle cancellations - UNREQUEST
      // TODO respond on err (eg: file not found) - REFUSE
      // TODO what if they already sent us a request? incoming requests queue

      if (metadb.uploadQueue.length) {
        // TODO should we allow multiple simultanious uploads? how many?
        metadb.uploadQueue.push({ sender: this.remotePk, requestMessage })
        metadb.emitWs({ uploadQueue: metadb.uploadQueue })
        this.sendMessage(QUEUED, messages.Queued.encode({ queuePosition: metadb.uploadQueue.length }))
        return // err?
      }

      const self = this
      const hashes = requestMessage.files.map(f => f.hash.toString('hex'))
      OwnFilesFromHashes(metadb)(hashes, (err, fileObjects) => {
        if (err) {
          console.log('Error retrieving filenames')
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

        // TODO check if specifying 'entries' is slowing things down
        const input = tar.pack('/', {
          entries,
          map: function (header) {
            // Remove the private part of the path name
            const fileObject = fileObjects.find(f => path.join(f.baseDir, f.filePath) === header.name)
            header.name = fileObject.filePath
            return header
          }
        })
        input.on('data', (data) => {
          // console.log('sending data', data)
          self.sendMessage(DATA, data)
        })
        input.on('error', (err) => {
          throw err // TODO
        })
        input.on('end', () => {
          console.log('END CALLED')
          self.sendMessage(FINISH, Buffer.from(''))
          finishUpload()
        })

        function finishUpload () {
          console.log('FINISH UPLOAD')
          const next = metadb.uploadQueue.shift()
          metadb.emitWs({ uploadQueue: metadb.uploadQueue })
          if (next && metadb.connectedPeers[next.remotePk]) {
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

// from simple-hypercore-protocol:
class XOR {
  constructor (nonces, split) {
    this.rnonce = nonces.rx
    this.tnonce = nonces.tx
    this.rx = sodium.crypto_stream_xor_instance(this.rnonce, split.rx.slice(0, 32))
    this.tx = sodium.crypto_stream_xor_instance(this.tnonce, split.tx.slice(0, 32))
  }

  encrypt (data) {
    this.tx.update(data, data)
    return data
  }

  decrypt (data) {
    this.rx.update(data, data)
    return data
  }

  destroy () {
    this.tx.final()
    this.rx.final()
  }

  static nonce () {
    const buf = Buffer.allocUnsafe(24)
    sodium.randombytes_buf(buf)
    return buf
  }
}
function logEvents (emitter, name) {
  let emit = emitter.emit
  name = name ? `(${name}) ` : ''
  emitter.emit = (...args) => {
    console.log(`\x1b[33m${args[0]}\x1b[0m`, util.inspect(args.slice(1), { depth: 1, colors: true }))
    emit.apply(emitter, args)
  }
}