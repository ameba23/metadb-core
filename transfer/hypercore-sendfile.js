const hypercoreIndexedFile = require('hypercore-indexed-file')
const replicator = require('@hyperswarm/replicator')
const hypercore = require('hypercore')
const ram = require('random-access-memory')
const fs = require('fs')
const log = console.log

module.exports = { publish, download }

function publish (files, baseDir, callback) {
  console.log('published called', files)
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
  const key = Buffer.from(link, 'hex') // TODO validation/processing
  // if (link.slice(0, 6) === 'dat://') link = link.slice(6) // TODO get rid 
  if (key.length !== 32) return callback(new Error('link is wrong length'))
  const feed = hypercore(ram, key)
  const swarm = replicator(feed)
  feed.on('peer-add', peer => {
    log('new peer, starting sync')
  })
  const target = fs.createWriteStream(downloadPath)

  feed.createReadStream({ live: true }).pipe(target)
  feed.on('sync', callback(null, true))
}
