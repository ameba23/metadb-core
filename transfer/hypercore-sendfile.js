// const hypercoreIndexedFile = require('hypercore-indexed-file')
const replicator = require('@hyperswarm/replicator')
const hypercore = require('hypercore')
const ram = require('random-access-memory')
// const raf = require('random-access-file')
// const tar = require('tar-fs')
const fs = require('fs')
const path = require('path')
const log = console.log
const crypto = require('../crypto')

const activeDownloads = []
const activeUploads = []

module.exports = { publish, upload, download }

function publish (files, baseDir, hash, callback) {
  console.log('published called', files)

  if (activeUploads.includes(hash)) return callback(null, false)
  activeUploads.push(hash) // TODO this should be a db write
  upload(files[0], hash, callback)
}

function upload (file, hash, callback) {
  const keypair = crypto.keypair(Buffer.from(hash, 'hex'))
  const options = { key: keypair.publicKey, secretKey: keypair.secretKey, indexing: true }
  // const feed = hypercoreIndexedFile(file, options, err => onfeed(err))

  const feed = hypercore(ram, options)
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
    // TODO add a prefix.
    callback(null, feed.key.toString('hex'), swarm)
  }
}

function download (link, downloadPath, callback) {
  if (activeDownloads.includes(link)) return callback(null, false)
  activeDownloads.push(link)
  const key = Buffer.from(link, 'hex') // TODO validation/processing
  console.log('******download called*******', link)
  // if (link.slice(0, 6) === 'dat://') link = link.slice(6) // TODO get rid 
  if (key.length !== 32) return callback(new Error('link is wrong length'))
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
  // TODO filename
  const target = fs.createWriteStream(path.join(downloadPath, link))
  // const target = tar.extract(downloadPath)


  feed.createReadStream({ live: true }).pipe(target)
  feed.on('sync', () => { log('File downlowded') })
  callback(null, swarm)
}

// adapted from hypercore-indexed-file
// function createStorage (file) {
//   return (filename) => {
//     if (filename.endsWith('data')) {
//       return raf(pathspec)
//     } else {
//       return ram(filename)
//     }
//   }
// }
