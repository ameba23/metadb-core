const sodium = require('sodium-native')

function sha256 (msg) {
  var hash = sodium.sodium_malloc(sodium.crypto_hash_sha256_BYTES)
  sodium.crypto_hash_sha256(hash, msg)
  return hash
}

function keyedHash (msg, key) {
  if (typeof key === 'string') {
    key = sha256(Buffer.from('key'))
  }
  if (typeof msg === 'string') msg = Buffer.from(msg)
  var hash = sodium.sodium_malloc(sodium.crypto_generichash_BYTES)
  sodium.crypto_generichash(hash, msg, key)
  return hash
}

module.exports = {
  sha256, keyedHash
}
