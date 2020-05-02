const hyperswarm = require('hyperswarm')
const path = require('path')
const noisePeer = require('noise-peer')
const pump = require('pump')
const sodium = require('sodium-native')
// const through = require('through2')
const tar = require('tar-fs')
const assert = require('assert')
const log = console.log
const crypto = require('../crypto')
const { packLinkGeneral, unpackLinkGeneral } = require('../util')
const { inspect } = require('util')
let activeDownloads = []
let activeUploads = []

const PREFIX = 'tarfs-v1://'

const packLink = (key) => packLinkGeneral(key, PREFIX)
const unpackLink = (link) => unpackLinkGeneral(link, PREFIX)

// Takes a logger fn which is used to pass stuff to the front end via websockets
module.exports = function (logObject = () => {}) {
  assert(typeof logObject === 'function', 'logObject, if given must be a function')

  function publish (fileObjects, link, encryptionKeys, callback) {
    const filePaths = fileObjects.map(f => f.filePath)
    log('published called', filePaths)

    // TODO how best to detect if this has been called more than once with the same files
    if (activeUploads.includes(filePaths.toString())) return callback(null, false)
    activeUploads.push(filePaths.toString()) // TODO this should be a db write

    const input = tar.pack('/', {
      entries: fileObjects.map(f => path.join(f.baseDir, f.filePath)),
      map: function (header) {
        // Remove the private part of the path name
        const fileObject = fileObjects.find(f => path.join(f.baseDir, f.filePath) === header.name)
        header.name = fileObject.filePath
        return header
      }
    })

    const swarm = hyperswarm()

    let swarmKey = unpackLink(link, PREFIX)

    if (link.length === 64 && !swarmKey) {
      swarmKey = Buffer.from(link, 'hex')
      link = packLink(swarmKey, PREFIX)
    }

    const discoveryKey = crypto.keyedHash(swarmKey, 'metadb')
    swarm.join(discoveryKey, { announce: true, lookup: true })

    // this will only allow one peer to connect
    swarm.once('connection', function (connection, info) {
      log('[publish] connected to peer')
      const noiseParams = Object.assign({ pattern: 'KK' }, encryptionKeys)
      const secureStream = noisePeer(connection, info.client, noiseParams)
      // secureStream.pipe(input).pipe(secureStream)
      pump(secureStream, input, secureStream, (err) => {
        if (err) log('[publish] error when stream ended', err)
        console.log('[publish] stream ended')
      })
      // input.pipe(through(encoder.encrypt())).pipe(connection)

      input.on('end', () => {
        log('[publish] finished reading files')
        // secureStream.end((err) => {
        // if (err) throw err // TODO
        log('[publish] leaving swarm')
        swarm.leave(discoveryKey)
        swarm.destroy()
        // TODO remove from activeUploads
        // })
      })
    })

    // input.on('data', () => {
    //   log('[publish] data block')
    // })

    // logEvents(input)
    input.on('error', (err) => {
      // TODO check if error is ENOENT (no such file)
      throw err // TODO callback(err)
    })

    log(`replicating ${link}`)
    callback(null, link, swarm)
  }

  function download (link, downloadPath, hashes, encryptionKeys, onDownloaded, callback) {
    if (activeDownloads.includes(link)) return callback(null, false)
    activeDownloads.push(link)

    const badHashes = []
    const verifiedHashes = []

    const swarmKey = unpackLink(link, PREFIX)
    if (!swarmKey) return callback(new Error(`Link does not have expected prefix ${PREFIX}`))
    if (swarmKey.length !== 32) return callback(new Error('link key is wrong length'))

    const files = {}
    const swarm = hyperswarm()
    const discoveryKey = crypto.keyedHash(swarmKey, 'metadb')
    swarm.join(discoveryKey, { announce: true, lookup: true })

    log('[download] swarm joined')

    // const target = fs.createWriteStream(downloadPath)
    const target = tar.extract(downloadPath, {
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
          logObject({ name, bytesRecieved: files[name].bytesRecieved, size: header.size })
          files[name].blocksRecieved += 1

          if (files[name].bytesRecieved === header.size) {
            log(`file ${name} downloaded`)
            logObject({ name, downloaded: true })
            const hashToCheck = sodium.sodium_malloc(sodium.crypto_hash_sha256_BYTES)
            files[name].hashToCheckInstance.final(hashToCheck)
            // verify hash
            if (hashes.includes(hashToCheck.toString('hex'))) {
              log(`hash for ${header.name} verified!`)
              logObject({ name, verified: true })
              verifiedHashes.push(hashToCheck.toString('hex'))
            } else {
              log(`hash for ${header.name} does not match!`)
              logObject({ name, verified: false })
              badHashes.push(hashToCheck)
            }
          }
        })
        return fileStream
      }
    })
    log('[download] target is ', downloadPath)

    swarm.on('connection', (connection, info) => {
      log('[download] peer connected')
      // only connect to them if we have a peer object
      // TODO should do info.deduplicate(localId, remoteId)
      if (info.peer) {
        log('[download] remote ip is: ', info.peer.host)
        // pump(socket, target, socket) // or just use .pipe?
        const noiseParams = Object.assign({ pattern: 'KK' }, encryptionKeys)
        const secureStream = noisePeer(connection, info.client, noiseParams)
        // connection.on('data', (data) => {console.log(data.toString())})
        // pump(secureStream, target)
        secureStream.pipe(target)
        secureStream.on('end', () => {
          log('[download] end called')
        })
        secureStream.on('error', (err) => {
          log('[download] Error from secure stream', err)
        })
        // logEvents(secureStream)
        // connection.pipe(through(encoder.decrypt())).pipe(target)
        connection.on('close', () => {
          log('[download] connection closed')
        })

        target.on('finish', () => {
          log('[download] tar stream finished')
          if ((verifiedHashes.length + badHashes.length) === hashes.length) {
            log('[download] expected number of files recieved')
          } else {
            log('[download] tar stream ended, and not enough files present')
          }

          if (verifiedHashes.length === hashes.length) {
            log('[download] all files hashes match!')
          }

          secureStream.end((err) => {
            if (err) throw err // TODO
            log('[download] ended secure stream.  leaving swarm')
            swarm.destroy()
            //         swarm.leave(discoveryKey, () => {
            // console.log('destroying swarm')
            //         })
            if (activeDownloads.includes(link)) onDownloaded(verifiedHashes, badHashes)
            activeDownloads = activeDownloads.filter(i => i !== link)
          })
        })
      }
    })

    target.on('error', (err) => {
      // TODO this is where encryption errors will be caught
      // (invalid tar header)
      throw err
    })

    target.on('close', () => {
      log('[download] tar stream ended')
      // tarStreamFinished()
    })
    callback(null, swarm)
  }
  return { publish, download, packLink, unpackLink }
}

// for debugging
function logEvents (emitter, name) {
  const emit = emitter.emit
  name = name ? `(${name}) ` : ''
  emitter.emit = (...args) => {
    console.log(`\x1b[33m${args[0]}\x1b[0m`, inspect(args.slice(1), { depth: 1, colors: true }))
    emit.apply(emitter, args)
  }
}
