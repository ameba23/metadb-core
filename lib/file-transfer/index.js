const pullLevel = require('pull-level')
const pull = require('pull-stream')
const debug = require('debug')
const FileTransfer = require('./file-transfer')

module.exports = function (metadb) {
  return function (stream, remotePk, options = {}) {
    const log = debug(`metadb-file-transfer ${metadb.keyHex.slice(0, 4)}`)
    options.log = log
    options.downloadPath = metadb.config.downloadPath
    options.getQueuePosition = function () {
      return metadb.uploadQueue.length
    }
    options.hashesToFilenames = function (hash, cb) {
      metadb.sharedb.get(hash, (err, fileObject) => {
        if (err) {
          return cb(null, { notFound: hash })
        }
        cb(null, Object.assign(fileObject, { hash }))
      })
    }
    const fileTransfer = new FileTransfer(stream, remotePk, Object.assign(options, { log }))

    fileTransfer.on('transferInfo', (info) => {
      metadb.emitWs(info)
    })

    fileTransfer.on('verified', (sha256) => {
      // Remove this request from our local db
      metadb.requestsdb.del(sha256, (err) => {
        if (err) console.log(err)
        log('Deleted entry from wishlist')
      })
      // or rather metadb.requestsdb.put(hash, {closed:true}) ?
    })

    fileTransfer.on('downloaded', (download) => {
      metadb.downloadeddb.put(
        `${Date.now()}!${download.sha256}`,
        {
          name: download.filename,
          from: remotePk.toString('hex'),
          verified: download.verified
        },
        (err) => {
          if (err) console.log(err)
          log('Added entry to downloadeddb')
        })
    })

    fileTransfer.on('uploaded', (fileObject) => {
      metadb.uploaddb.put(`${Date.now()}!${fileObject.hash}`,
        { name: fileObject.filePath, to: remotePk.toString('hex') },
        (err) => {
          if (err) console.log(err)
          log('Added entry to uploaddb')
        }
      )
    })

    fileTransfer.on('request', (requestMessage) => {
      // Add this request to the queue
      metadb.uploadQueue.push({ sender: remotePk, requestMessage })
      metadb.emitWs({ uploadQueue: metadb.uploadQueue })
    })

    fileTransfer.on('requestComplete', () => {
      // take this message off the queue (TODO: explicitly remove this message)
      metadb.uploadQueue.shift()
      metadb.emitWs({ uploadQueue: metadb.uploadQueue })
      if (metadb.uploadQueue.length && metadb.connectedPeers[metadb.uploadQueue[0].remotePk]) {
        const next = metadb.uploadQueue[0]
        metadb.connectedPeers[next.remotePk].onRequest(next.requestMessage)
      }
    })

    fileTransfer.on('unrequest', (hashes) => {
      // TODO double check this:
      metadb.uploadQueue = metadb.uploadQueue.map((item) => {
        if (item.sender.toString('hex') !== remotePk.toString('hex')) return item
        item.requestMessage.files = item.requestMessage.files.filter((file) => {
          return (!hashes.includes(file.sha256.toString('hex')))
        })
      })
      metadb.emitWs({ uploadQueue: metadb.uploadQueue })
    })

    // Check our requests db for open requests for this peer,
    // and send them as a batch
    pull(
      pullLevel.read(metadb.requestsdb, { live: false }),
      pull.asyncMap((entry, cb) => {
        console.log('*********************************fond one!')
        metadb.files.get(entry.key, (err, metadata) => {
          if (!err && metadata.holders.includes(remotePk.toString('hex'))) {
            // if (entry.value.open === true) TODO
            cb(null, entry)
          }
        })
      }),
      pull.collect((err, entries) => {
        if (err) throw err // TODO
        log(`Requesting ${entries.length} existing entries in wishlist`)
        if (entries.length) fileTransfer.sendRequest(entries)
      })
    )

    return fileTransfer
  }
}
