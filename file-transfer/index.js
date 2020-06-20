const SimpleMessageChannels = require('simple-message-channels')
const tar = require('tar-fs')
const path = require('path')
const sodium = require('sodium-native')
const log = console.log

const messages = require('./messages')
const OwnFilesFromHashes = require('../queries/own-files-from-hashes')

// message types:
const DATA = 0
const REQUEST = 1
const UNREQUEST = 2
const QUEUED = 4
const REFUSE = 5

module.exports = function (metadb) {
  class FileTransfer {
    constructor (remotePk, stream, encryptionKeySplit) {
      this.remotePk = remotePk
      this.stream = stream
      this.target = null
      this.requestsQueue = [] // pending requests *FROM* us

      // TODO - nonces
      const nonces = {
        rnonce: Buffer.from('this is really 24 bytes!'),
        tnonce: Buffer.from('this is really 24 bytes!')
      }
      this.encryption = new XOR(nonces, encryptionKeySplit)

      const self = this
      this.smc = new SimpleMessageChannels({
        onmessage (channel, type, message) {
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
              // TODO
              break
            default:
              // unknown type
          }
        }
      })
      // this.stream.on('data', this.smc.recv)
      this.stream.on('data', (data) => {
        console.log('got data!')
        this.smc.recv(this.encryption.decrypt(data))
      })

      // Check our requests db for open requests for this peer,
      // and send them as a batch
      const readStream = metadb.requestsdb.createReadStream()
      const toRequest = []
      readStream.on('data', (entry) => {
        metadb.files.get(entry.key, (err, metadata) => {
          if (!err && metadata.holders.includes(remotePk.toString('hex'))) {
            // if (entry.value.open === true) TODO
            toRequest.push(entry)
          }
        })
      })
      readStream.on('error', (err) => {
        // TODO log
        throw err
      })
      readStream.on('end', () => {
        if (toRequest.length) this.sendRequest(toRequest)
      })
    }

    // Takes requests objects of the form:
    //   key: hash, value: { start, end }
    sendRequest (givenRequests) {
      const self = this
      if (!givenRequests.length) return
      // Check we dont allready have one going - if (target) add request to the queue
      if (this.target) return this.requestsQueue.push(givenRequests)

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

      this.target = tar.extract(metadb.downloadPath, {
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
        // destroy stream? target.destroy?
        // target = false?

        // Shift the request off the requestQueue
        const next = self.requestQueue.shift()
        if (next) self.sendRequest(next)
      })
    }

    // Takes requests objects of the form:
    //   key: hash, value: { start, end }
    cancelRequest (givenRequests) {
      if (!givenRequests.length) return
      // TODO find it in requestsQueue and remove

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
      // Always use channel 0
      this.stream.write(this.encryption.encrypt(this.smc.send(0, type, message)))
    }

    onData (data) {
      if (this.target) return this.target.write(data)
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
          self.sendMessage(0, data)
        })
        input.on('error', (err) => {
          throw err // TODO
        })
        input.on('end', finishUpload)

        function finishUpload () {
          const next = metadb.uploadQueue.shift()
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
    this.rnonce = nonces.rnonce
    this.tnonce = nonces.tnonce
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
