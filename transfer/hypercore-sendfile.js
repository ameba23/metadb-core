const hypercoreIndexedFile = require('hypercore-indexed-file')
const replicator = require('@hyperswarm/replicator')
const hypercore = require('hypercore')
const ram = require('random-access-memory')
const fs = require('fs')
const log = console.log

module.exports = { publish, download }

function publish (files, baseDir, callback) {
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
  }
}

function download (link, downloadPath, callback) {
  const key = Buffer.from(link, 'hex') // TODO validation/processing
  const feed = hypercore(ram, key)
  const swarm = replicator(feed)
  feed.on('peer-add', peer => {
    log('new peer, starting sync')
  })
  const target = fs.createWriteStream(downloadPath)

  feed.createReadStream({ live: true }).pipe(target)
  feed.on('sync', callback(null, true))
}
