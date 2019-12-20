const sodium = require('sodium-native')
const assert = require('assert')

function sha256 (msg) {
  var hash = sodium.sodium_malloc(sodium.crypto_hash_sha256_BYTES)
  sodium.crypto_hash_sha256(hash, msg)
  return hash
}

function genericHash (msg, key) {
  const hash = sodium.sodium_malloc(sodium.crypto_generichash_BYTES)
  sodium.crypto_generichash(hash, msg, key)
  return hash
}

function keyedHash (msg, key) {
  if (typeof key === 'string') {
    key = genericHash(Buffer.from(key))
  }
  if (key) assert(Buffer.isBuffer(key), 'key must be a buffer or a string')
  if (typeof msg === 'string') msg = Buffer.from(msg)
  assert(Buffer.isBuffer(msg), 'msg must be a buffer or a string')
  return genericHash(msg, key)
}
module.exports = {
  sha256, keyedHash
}
