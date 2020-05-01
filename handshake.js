const crypto = require('./crypto')

// This is to prove that both parties know the 'key' of the swarm
// hypercore protocol already does this, but the way multifeed
// works would mean we would need a multifeed instance for each swarm
// we connect to.

module.exports = function (theyAreInitiator, stream, key, callback) {
  const randomToken = crypto.randomBytes(32) // Used in handshake
  if (theyAreInitiator) { // if *they* are the initiator
    const handleMessage = function (data) {
      if (data.length < 16) return callback(new Error('Handshake unsuccessful'))
      const messageType = data.slice(0, 16).toString()
      if (messageType === 'metadb-handshake' && data.length === 48) {
        console.log('[non-initiator] handshaking...')
        stream.write(Buffer.concat([
          Buffer.from('handshake-capabi'),
          crypto.keyedHash(key, data.slice(16, 48)),
          randomToken
        ]))
      }
      if (messageType === 'handshake-capabi' && data.length === 48) {
        console.log('[non-initiator] recieved final message')
        if (data.slice(16, 48).compare(crypto.keyedHash(key, randomToken))) return callback(new Error('Unable to verify capability'))
        console.log('handshake complete!')
        stream.removeListener('data', handleMessage)
        return callback()
      }
    }

    stream.on('data', handleMessage)
  } else {
    const messageHandler = function (data) {
      if (data.length < 16) return callback(new Error('Handshake unsuccessful'))
      if (data.slice(0, 16).toString() === 'handshake-capabi') {
        console.log('[initiator] capability recieved...')
        // check it, if its valid, send one back
        const theirHash = data.slice(16, 48)

        if (theirHash.compare(crypto.keyedHash(key, randomToken))) return callback(new Error('Unable to verify capability'))
        console.log('[initiator] capability verified, sending one back...')
        stream.write(Buffer.concat([
          Buffer.from('handshake-capabi'),
          crypto.keyedHash(key, data.slice(48))
        ]))
        stream.removeListener('data', messageHandler)
        return callback()
      }
    }
    stream.on('data', messageHandler)
    stream.write(Buffer.concat([Buffer.from('metadb-handshake'), randomToken]))
  }
}
