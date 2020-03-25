// const hypercoreIndexedFile = require('hypercore-indexed-file')
const hyperswarm = require('hyperswarm')
const pump = require('pump')
const path = require('path')
// const noisePeer = require('noise-peer')
const sodium = require('sodium-native')
// const raf = require('random-access-file')
const tar = require('tar-fs')
const log = console.log
const crypto = require('../crypto')
const util = require('util') // temp

let activeDownloads = []
let activeUploads = []

const PREFIX = 'tarfs-v1://'

module.exports = { publish, download }

function publish (fileObjects, baseDir, link, callback) {
  if (typeof link === 'function' && !callback) {
    callback = link
    link = null
  }

  const filePaths = fileObjects.map(f => f.filePath)
  log('published called', filePaths)

  // TODO how best to detect if this has been called more than once with the same files
  if (activeUploads.includes(filePaths.toString())) return callback(null, false)
  activeUploads.push(filePaths.toString()) // TODO this should be a db write

  // Derive a keypair from the hash of the file
  //  - good because it gives content-addressing - other peers can join
  //  - bad for security - so currently not using
  // const keypair = crypto.keypair(Buffer.from(hash, 'hex'))
  // const optionsForHypercore = { key: keypair.publicKey, secretKey: keypair.secretKey }

  const input = tar.pack('/', {
    entries: fileObjects.map(f => path.join(f.baseDir, f.filePath)),
    map: function (header) {
      // Remove the private part of the dir
      const fileObject = fileObjects.find(f => path.join(f.baseDir, f.filePath) === header.name)
      header.name = fileObject.filePath
      return header
    }
  })

  const swarm = hyperswarm()

  // TODO: something cleverer for key generation, eg: use a diffie hellman shared secret
  // between sender and reciever
  const key = link ? unpackLink(link) : Buffer.alloc(32)
  sodium.randombytes_buf(key)

  swarm.join(key, { announce: true, lookup: true })

  // this will only allow one peer to connect
  swarm.once('connection', function (connection, info) {
    // pump(connection, input, connection)
    log('[publish] connected to peer')
    input.pipe(connection)
  })

  // input.on('data', () => {
  //   log('[publish] data block')
  // })

  input.on('end', () => {
    log('[publish] finished reading files')
    log('leaving swarm')
    swarm.leave(key)
    swarm.destroy()
    // TODO remove from activeUploads
  })

  input.on('error', (err) => {
    // TODO check if error is ENOENT (no such file)
    throw err // callback(err)
  })

  link = link || packLink(key)

  log(`replicating ${link}`)
  callback(null, link, swarm)
}

function download (link, downloadPath, hashes, onDownloaded, callback) {
  if (activeDownloads.includes(link)) return callback(null, false)
  activeDownloads.push(link)

  const badHashes = []
  const verifiedHashes = []

  const key = unpackLink(link)
  if (!key) return callback(new Error(`Link does not have expected prefix ${PREFIX}`))
  if (key.length !== 32) return callback(new Error('link key is wrong length'))

  const files = {}
  const swarm = hyperswarm()
  swarm.join(key, { announce: true, lookup: true })

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
        files[name].blocksRecieved += 1

        if (files[name].bytesRecieved === header.size) {
          log(`file ${name} downloaded`)
          const hashToCheck = sodium.sodium_malloc(sodium.crypto_hash_sha256_BYTES)
          files[name].hashToCheckInstance.final(hashToCheck)
          // verify hash
          if (hashes.includes(hashToCheck.toString('hex'))) {
            log(`hash for ${header.name} verified!`)
            verifiedHashes.push(hashToCheck.toString('hex'))
          } else {
            log(`hash for ${header.name} does not match!`)
            badHashes.push(hashToCheck)
          }
        }
      })
      return fileStream
    }
  })
  log('[download] target is ', downloadPath)

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

    swarm.leave(key)
    swarm.destroy()
    if (activeDownloads.includes(link)) onDownloaded(verifiedHashes, badHashes)
    activeDownloads = activeDownloads.filter(i => i !== link)
  })

  swarm.on('connection', (connection, info) => {
    log('[download] peer connected')
    if (info.peer) log(info.peer.host)
    // pump(socket, target, socket) // or just use .pipe?
    connection.pipe(target)
    connection.on('close', () => {
      log('connection closed')
    })
  })

  target.on('error', (err) => {
    throw err
  })

  target.on('close', () => {
    log('tar stream ended')
  })
  callback(null, swarm)
}

// for debugging
// function logEvents (emitter, name) {
//   const emit = emitter.emit
//   name = name ? `(${name}) ` : ''
//   emitter.emit = (...args) => {
//     console.log(`\x1b[33m${args[0]}\x1b[0m`, util.inspect(args.slice(1), { depth: 1, colors: true }))
//     emit.apply(emitter, args)
//   }
// }

function packLink (key) {
  return PREFIX + key.toString('hex')
}

function unpackLink (link) {
  return (link.slice(0, PREFIX.length) === PREFIX)
    ? Buffer.from(link.slice(PREFIX.length), 'hex')
    : false
}
