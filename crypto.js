const sodium = require('sodium-native')
const assert = require('assert')
const GENERIC_HASH_BYTES = sodium.crypto_generichash_BYTES

class Sha256Instance {
  constructor () {
    this.instance = sodium.crypto_hash_sha256_instance()
  }

  update (input) {
    this.instance.update(input)
  }

  final () {
    const hash = sodium.sodium_malloc(sodium.crypto_hash_sha256_BYTES)
    this.instance.final(hash)
    return hash
  }
}

function sha256 (msg) {
  var hash = sodium.sodium_malloc(sodium.crypto_hash_sha256_BYTES)
  sodium.crypto_hash_sha256(hash, msg)
  return hash
}

function genericHash (msg, key) {
  const hash = sodium.sodium_malloc(GENERIC_HASH_BYTES)
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

function keypair (seed) {
  const publicKey = sodium.sodium_malloc(sodium.crypto_sign_PUBLICKEYBYTES)
  const secretKey = sodium.sodium_malloc(sodium.crypto_sign_SECRETKEYBYTES)

  if (seed) sodium.crypto_sign_seed_keypair(publicKey, secretKey, seed)
  else sodium.crypto_sign_keypair(publicKey, secretKey)

  return {
    publicKey,
    secretKey
  }
}

function randomBytes (length) {
  const result = Buffer.alloc(length)
  sodium.randombytes_buf(result)
  return result
}

class CryptoEncoder {
  constructor (nonces, key) {
    // Taken from simple-hypercore-protocol
    this.rnonce = nonces.rnonce
    this.tnonce = nonces.tnonce
    this.rx = sodium.crypto_stream_xor_instance(this.rnonce, key)
    this.tx = sodium.crypto_stream_xor_instance(this.tnonce, key)
  }

  encrypt () {
    const self = this
    return function (chunk, enc, callback) {
      // TODO should be able to do in-place encryption
      const out = Buffer.alloc(chunk.length)
      self.tx.update(out, chunk)
      return callback(null, out)
    }
  }

  decrypt () {
    const self = this
    return function (chunk, enc, callback) {
      const out = Buffer.alloc(chunk.length)
      self.rx.update(out, chunk)
      return callback(null, out)
    }
  }
}

function edToCurvePk (publicKey) {
  if (typeof publicKey === 'string') publicKey = Buffer.from(publicKey, 'hex')
  const curvePublicKey = sodium.sodium_malloc(sodium.crypto_box_PUBLICKEYBYTES)
  sodium.crypto_sign_ed25519_pk_to_curve25519(curvePublicKey, publicKey)
  return curvePublicKey
}

function edToCurveSk (secretKey) {
  if (typeof secretKey === 'string') secretKey = Buffer.from(secretKey, 'hex')
  const curveSecretKey = sodium.sodium_malloc(sodium.crypto_box_SECRETKEYBYTES)
  sodium.crypto_sign_ed25519_sk_to_curve25519(curveSecretKey, secretKey)
  return curveSecretKey
}

function calculateAgreement (publicKey, keypair, context) {
  context = context || 'metadb'
  if (typeof publicKey === 'string') publicKey = Buffer.from(publicKey, 'hex')
  if (typeof keypair.secretKey === 'string') keypair.secretKey = Buffer.from(keypair.secretKey, 'hex')
  if (typeof keypair.publicKey === 'string') keypair.publicKey = Buffer.from(keypair.publicKey, 'hex')
  if (typeof context === 'string') context = Buffer.from('context')

  const curvePublicKey = sodium.sodium_malloc(sodium.crypto_box_PUBLICKEYBYTES)

  const curveKeypair = {}
  // curveKeypair.publicKey = sodium.sodium_malloc(sodium.crypto_box_PUBLICKEYBYTES)
  curveKeypair.secretKey = sodium.sodium_malloc(sodium.crypto_box_SECRETKEYBYTES)

  sodium.crypto_sign_ed25519_pk_to_curve25519(curvePublicKey, publicKey)
  // sodium.crypto_sign_ed25519_pk_to_curve25519(curveKeypair.publicKey, keypair.publicKey)
  sodium.crypto_sign_ed25519_sk_to_curve25519(curveKeypair.secretKey, keypair.secretKey)
  const dhAgreement = sodium.sodium_malloc(sodium.crypto_scalarmult_BYTES)
  sodium.crypto_scalarmult(dhAgreement, curveKeypair.SecretKey, curvePublicKey)

  // TODO possibly use blake2-512 for two keys, rx and tx
  // you can do this just by giving generichash a 64 byte buffer
  const sortedPublicKeys = [publicKey, keypair.publicKey].sort(Buffer.compare)
  return genericHash(Buffer.concat(sortedPublicKeys.concat([context])), genericHash(dhAgreement))
}

module.exports = {
  sha256,
  keyedHash,
  GENERIC_HASH_BYTES,
  keypair,
  Sha256Instance,
  randomBytes,
  CryptoEncoder,
  calculateAgreement,
  edToCurvePk,
  edToCurveSk
}
