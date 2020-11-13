const { MetadbMessage } = require('../messages')
const crypto = require('../crypto')
const { keyToTopic } = require('../swarm')
const log = require('debug')('metadb')

// Publish messages to our feed

module.exports = function Publish (metadb) {
  const publishMessage = function (message, type, callback) {
    if (!metadb.localFeed) return callback(new Error('No local feed'))

    const toEncode = {
      timestamp: Date.now(),
      [type]: message
    }
    log('Publishing message:', toEncode)
    metadb.localFeed.append(toEncode, callback)
  }

  return {
    publishMessage,
    about (about, callback) {
      if (typeof about === 'string') about = { name: about }
      if (about.name === '') return callback(new Error('Cannot give empty string as name'))
      publishMessage(about, 'about', callback)
    },
    fileComment (commentMessage, callback) {
      if (!commentMessage.sha256) return callback(new Error('sha256 not given'))
      commentMessage.sha256 = Buffer.from(commentMessage.sha256, 'hex')
      publishMessage(commentMessage, 'fileComment', callback)
    },
    header (callback) {
      publishMessage({ type: 'metadb' }, 'header', callback)
    },
    rmFiles (files, callback) {
      if (!Array.isArray(files)) files = [files]
      files = files.map(f => Buffer.from(f, 'hex'))
      publishMessage({ files }, 'rmFiles', callback)
    },
    wallMessage (message, swarmKey, callback) {
      const plain = MetadbMessage.encode({
        wallMessage: { message },
        timestamp: Date.now()
      })
      const toEncode = {
        private: {
          symmetric: crypto.secretBox(plain, keyToTopic(swarmKey))
        }
      }
      metadb.localFeed.append(toEncode, (err, seq) => {
        if (err) return callback(err)
        log('Publishing wall message', seq)
        callback(null, seq)
      })
    }
  }
}
