const { MetadbMessage } = require('../messages')
const crypto = require('../crypto')

module.exports = function Publish (metadb) {
  const publishMessage = function (message, type, callback) {
    const toEncode = { timestamp: Date.now() }
    toEncode[type] = message
    metadb.localFeed.append(toEncode, callback)
  }

  return {
    publishMessage,
    about (about, callback) {
      if (!metadb.localFeed) return callback(new Error('No local feed'))
      if (typeof about === 'string') about = { name: about }
      if (about.name === '') return callback(new Error('Cannot give empty string as name'))
      publishMessage(about, 'about', callback)
    },
    fileComment (commentMessage, callback) {
      // TODO
      if (!metadb.localFeed) return callback(new Error('No local feed'))
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
        wallMessage: message,
        timestamp: Date.now()
      })
      const toEncode = {
        private: {
          ciphertext: {
            symmetric: crypto.secretBox(plain, swarmKey)
          }
        }
      }
      metadb.localFeed.append(toEncode, callback)
    }
  }
}
