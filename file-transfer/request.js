const pull = require('pull-stream')
const assert = require('assert')
const { isHexString } = require('../util')
const SHA256_BYTES = 32 // TODO

// Add the requested files to local db
// If we are connected to the peer, pass the requests to them

module.exports = function (metadb) {
  return function request (files, callback) {
    try {
      if (typeof files === 'string') files = [files]
      assert(Array.isArray(files), 'Files must be an array')
      files.forEach((file) => {
        assert(isHexString(file, SHA256_BYTES), 'Files must be hex encoded hashes')
      })
    } catch (err) { return callback(err) }

    const queuedRequests = {}

    pull(
      pull.values(files),
      pull.asyncMap((file, cb) => {
        // Check if we already have a request for this file
        metadb.requestsdb.get(file, (err, existingEntry) => {
          // TODO search for file locally / check offset
          if (!err) return cb(null, { key: file, value: existingEntry })
          metadb.requestsdb.put(file, { open: true }, (err) => {
            if (err) return callback(new Error('Error writing request to local db'))
            return cb(null, { key: file, value: {} })
          })
        })
      }),
      pull.asyncMap((fileObj, cb) => {
        // Find the file in our db
        metadb.files.get(fileObj.key, (err, metadata) => {
          if (err) {
            console.log('Warning: Requested file is not in our database')
            // Broadcast the request (temporary, TODO)
            Object.keys(metadb.connectedPeers).forEach((holder) => {
              queuedRequests[holder] = queuedRequests[holder] || []
              queuedRequests[holder].push(fileObj)
            })
            return cb()
          }
          metadata.holders.forEach((holder) => {
            if (holder !== metadb.keyhex) {
              if (metadb.connectedPeers[holder]) {
                queuedRequests[holder] = queuedRequests[holder] || []
                queuedRequests[holder].push(fileObj)
                return cb()
              }
            }
          })
        })
      }),
      pull.collect((err) => {
        // Give the requests in batches
        Object.keys(queuedRequests).forEach((holder) => {
          metadb.connectedPeers[holder].sendRequest(queuedRequests[holder])
        })
        return callback(err)
      })
    )
  }
}

module.exports.unrequest = function (metadb) {
  return function (files, callback) {
    try {
      if (typeof files === 'string') files = [files]
      console.log(files)
      assert(Array.isArray(files), 'Files must be an array')
      files.forEach((file) => {
        assert(isHexString(file, SHA256_BYTES), 'Files must be hex encoded hashes')
      })
    } catch (err) { return callback(err) }

    pull(
      pull.values(files),
      pull.asyncMap((file, cb) => {
        metadb.requestsdb.del(file, (err) => {
          if (err) { console.log('error!', err) }
          cb(err, file)
        })
      }),
      pull.collect((err) => {
        console.log(err)
        callback(err)
      })
    )
    // TODO cancel current downloads
  }
}
