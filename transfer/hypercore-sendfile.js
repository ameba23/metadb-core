const hypercoreIndexedFile = require('hypercore-indexed-file')
const replicator = require('@hyperswarm/replicator')
const hypercore = require('hypercore')
const ram = require('random-access-memory')
const fs = require('fs')
const path = require('path')
const log = console.log

const activeDownloads = []
const activeUploads = []

module.exports = { publish, download }

function publish (files, baseDir, callback) {
  console.log('published called', files)

  if (activeUploads.includes(files[0])) return callback(null, false)
  activeUploads.push(files[0])

  const feed = hypercoreIndexedFile(files[0], err => onfeed(err, feed))

  function onfeed (err, feed) {
    if (err) return console.error(err)
    const swarm = replicator(feed)
    log('replicating ' + feed.key.toString('hex'))
    feed.on('peer-add', peer => {
      log('new peer, starting sync')
    })
    feed.on('peer-remove', peer => {
      log('peer removed')
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
  feed.on('peer-add', (peer) => {
    log('new peer, starting sync')
  })
  feed.on('peer-remove', peer => {
    log('peer removed')
  })
  // TODO filename
  const target = fs.createWriteStream(path.join(downloadPath, link))

  feed.createReadStream({ live: true }).pipe(target)
  feed.on('sync', () => { log('File downlowded') })
  callback(null, true) // swarm
}
