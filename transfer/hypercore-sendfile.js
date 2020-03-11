// const hypercoreIndexedFile = require('hypercore-indexed-file')
const hyperswarm = require('hyperswarm')
const pump = require('pump')
// const noisePeer = require('noise-peer')
const sodium = require('sodium-native')
// const raf = require('random-access-file')
// const tar = require('tar-fs')
const fs = require('fs')
const path = require('path')
const log = console.log
const crypto = require('../crypto')
const util = require('util') // temp

let activeDownloads = []
let activeUploads = []

module.exports = { publish, upload, download }

function publish (fileObjects, baseDir, callback) {
  log('published called', fileObjects)

  if (activeUploads.includes(fileObjects[0].hash)) return callback(null, false)
  activeUploads.push(fileObjects[0].hash) // TODO this should be a db write
  upload(fileObjects[0], callback)
}

function upload (fileObject, callback) {
  const { file, hash } = fileObject

  // Derive a keypair from the hash of the file
  //  - good because it gives content-addressing - other peers can join
  //  - bad for security - so currently not using
  // const keypair = crypto.keypair(Buffer.from(hash, 'hex'))
  // const optionsForHypercore = { key: keypair.publicKey, secretKey: keypair.secretKey }

  let uploadedBytes = 0

  // const input = tar.pack(baseDir, { entries: files})

  const input = fs.createReadStream(file)
  const swarm = hyperswarm()

  // TODO:
  const key = Buffer.alloc(32)
  sodium.randombytes_buf(key)

  swarm.join(key, { announce: true, lookup: true })
  // this will allow only one peer to connect
  swarm.once('connection', function (connection, info) {
    // pump(connection, input, connection)
    console.log('[publish] connection')
    input.pipe(connection)
  })

  // input.on('data', () => {
  //   console.log('[publish] data block')
  // })

  input.on('end', () => {
    log('[publish] finished reading file')
    log('leaving swarm')
    swarm.leave(key)
    swarm.destroy()
  })

  input.on('error', (err) => {
    throw err
  })

  log('replicating ' + key.toString('hex'))
  callback(null, key.toString('hex'), swarm)
}

function download (link, downloadPath, size, onDownloaded, callback) {
  if (activeDownloads.includes(link)) return callback(null, false)
  activeDownloads.push(link)

  const key = Buffer.from(link, 'hex') // TODO validation/processing
  // if (link.slice(0, 6) === 'dat://') link = link.slice(6) // TODO get rid
  if (key.length !== 32) return callback(new Error('link is wrong length'))
  let blocksRecieved = 0
  let bytesRecieved = 0
  const hashToCheckInstance = sodium.crypto_hash_sha256_instance()
  const swarm = hyperswarm()
  swarm.join(key, { announce: true, lookup: true })
  // TODO multiple filenames
  const target = fs.createWriteStream(downloadPath)
  console.log('target is ', downloadPath)

  swarm.on('connection', (connection, info) => {
    console.log('[download] peer connected')
    if (info.peer) console.log(info.peer.host)
    // pump(socket, target, socket) // or just use .pipe?
    connection.pipe(target)
    connection.on('data', (chunk) => {
      bytesRecieved += chunk.length
      console.log(`[download] chunk ${blocksRecieved} added, ${bytesRecieved} of ${size} (${Math.round(bytesRecieved / size * 100)}%) `)
      hashToCheckInstance.update(chunk)
      blocksRecieved += 1
      if (bytesRecieved === size) downloaded()
    })

    function downloaded () {
      log('[download] File downlowded')
      swarm.leave(key)
      swarm.destroy()
      const hashToCheck = sodium.sodium_malloc(sodium.crypto_hash_sha256_BYTES)
      hashToCheckInstance.final(hashToCheck)
      if (activeDownloads.includes(link)) onDownloaded(hashToCheck)
      activeDownloads = activeDownloads.filter(i => i !== link)
    }
  })
  // const target = tar.extract(downloadPath)
  target.on('error', (err) => {
    throw err
  })

  callback(null, swarm)
}

// for debugging
function logEvents (emitter, name) {
  let emit = emitter.emit
  name = name ? `(${name}) ` : ''
  emitter.emit = (...args) => {
    console.log(`\x1b[33m${args[0]}\x1b[0m`, util.inspect(args.slice(1), { depth: 1, colors: true }))
    emit.apply(emitter, args)
  }
}
