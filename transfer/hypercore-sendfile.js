// const hypercoreIndexedFile = require('hypercore-indexed-file')
const replicator = require('@hyperswarm/replicator')
const hypercore = require('hypercore')
const ram = require('random-access-memory')
const sodium = require('sodium-native')
// const raf = require('random-access-file')
// const tar = require('tar-fs')
const fs = require('fs')
const path = require('path')
const log = console.log
const crypto = require('../crypto')

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

  // const feed = hypercoreIndexedFile(file, options, err => onfeed(err))

  const feed = hypercore(createStorage()) // ram

  // tar.pack(baseDir, { entries: files}).pipe(feed.createWriteStream())

  fs.createReadStream(file).pipe(feed.createWriteStream())
  onfeed()

  function onfeed (err) {
    if (err) return callback(err)
    const swarm = replicator(feed)
    log('replicating ' + feed.key.toString('hex'))
    feed.on('peer-add', peer => {
      log('[publish] new peer, starting sync')
    })
    feed.on('peer-open', peer => {
      log('[publish] peer channel open')
    })
    feed.on('peer-remove', peer => {
      log('[publish] peer removed')
    })
    feed.on('sync', () => {
      log('[publish] sync called!!!!') // TODO i dont think this ever gets called
    })
    // TODO add a prefix.
    callback(null, feed.key.toString('hex'), swarm)
  }
}

function download (link, downloadPath, onDownloaded, callback) {
  if (activeDownloads.includes(link)) return callback(null, false)
  activeDownloads.push(link)

  const key = Buffer.from(link, 'hex') // TODO validation/processing

  console.log('******download called*******', link)
  // if (link.slice(0, 6) === 'dat://') link = link.slice(6) // TODO get rid
  if (key.length !== 32) return callback(new Error('link is wrong length'))

  const hashToCheckInstance = sodium.crypto_hash_sha256_instance()
  const feed = hypercore(ram, key)
  const swarm = replicator(feed)
  swarm.on('connection', (socket, details) => {
    if (details.peer) console.log(details.peer.host)
  })
  feed.on('peer-add', (peer) => {
    log('[download] new peer, starting sync')
  })
  feed.on('peer-open', peer => {
    log('[download] peer channel open')
  })
  feed.on('peer-remove', peer => {
    log('[download] peer removed')
  })
  feed.on('close', peer => {
    log('[download] feed closed')
  })
  // TODO multiple filenames
  const target = fs.createWriteStream(downloadPath)
  // const target = tar.extract(downloadPath)

  feed.createReadStream({ live: true }).pipe(target)

  feed.on('data', (chunk) => {
    console.log('[download] chunk added') // temporary
    // TODO should be able to verifiy parts of big files.
    hashToCheckInstance.update(chunk)
    // could also stream to the front end here
  })

  feed.on('sync', () => {
    log('[download] File downlowded')
    swarm.leave(feed.discoveryKey)
    activeDownloads = activeDownloads.filter(i => i !== link)
    feed.close() // Not sure if this is needed

    const hashToCheck = sodium.sodium_malloc(sodium.crypto_hash_sha256_BYTES)
    hashToCheckInstance.final(hashToCheck)
    onDownloaded(hashToCheck)
  })

  callback(null, swarm)
}

// adapted from hypercore-indexed-file
function createStorage (file) {
  return (filename) => {
    log(`[storage] ${filename}`)
    return ram(filename)
  }
  // if (filename.endsWith('data')) {
  //   return raf(pathspec)
  // } else {
  //   return ram(filename)
  // }
}
