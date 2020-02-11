const hypercoreIndexedFile = require('hypercore-indexed-file')
const replicator = require('@hyperswarm/replicator')
const hypercore = require('hypercore')
const ram = require('random-access-memory')
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
  const options = { key: keypair.publicKey, secretKey: keypair.secretKey }
  const feed = hypercoreIndexedFile(file, options, err => onfeed(err, feed))

  function onfeed (err, feed) {
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
    console.log(JSON.stringify(details, null, 4))
  })
  feed.on('peer-add', (peer) => {
    log('[download] new peer, starting sync')
  })
  feed.on('peer-open', peer => {
    log('[publish] peer channel open')
  })
  feed.on('peer-remove', peer => {
    log('[download] peer removed')
  })
  // TODO filename
  const target = fs.createWriteStream(path.join(downloadPath, link))

  feed.createReadStream({ live: true }).pipe(target)
  feed.on('sync', () => { log('File downlowded') })
  callback(null, true) // swarm
}
