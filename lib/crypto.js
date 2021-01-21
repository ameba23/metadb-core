const sodium = require('sodium-native')
const ZERO = Buffer.alloc(32)

class Sha256 {
  constructor (state) {
    this.state = state || init()

    function init () {
      const state = Buffer.alloc(sodium.crypto_hash_sha256_STATEBYTES)
      sodium.crypto_hash_sha256_init(state)
      return state
    }
  }

  update (data) {
    sodium.crypto_hash_sha256_update(this.state, data)
  }

  final () {
    const hash = Buffer.alloc(sodium.crypto_hash_sha256_BYTES)
    sodium.crypto_hash_sha256_final(this.state, hash)
    return hash
  }
}

function randomBytes (length) {
  const result = Buffer.alloc(length)
  sodium.randombytes_buf(result)
  return result
}

module.exports = {
  Sha256,

  edToCurvePk (publicKey) {
    if (typeof publicKey === 'string') publicKey = Buffer.from(publicKey, 'hex')
    const curvePublicKey = sodium.sodium_malloc(sodium.crypto_box_PUBLICKEYBYTES)
    sodium.crypto_sign_ed25519_pk_to_curve25519(curvePublicKey, publicKey)
    return curvePublicKey
  },

  edToCurveSk (secretKey) {
    if (typeof secretKey === 'string') secretKey = Buffer.from(secretKey, 'hex')
    const curveSecretKey = sodium.sodium_malloc(sodium.crypto_box_SECRETKEYBYTES)
    sodium.crypto_sign_ed25519_sk_to_curve25519(curveSecretKey, secretKey)
    return curveSecretKey
  },

  genericHash (msg, key) {
    if (!key) key = ZERO
    const hash = sodium.sodium_malloc(sodium.crypto_generichash_BYTES)
    sodium.crypto_generichash(hash, msg, key)
    return hash
  },

  secretBox (message, secretKey) {
    if (!Buffer.isBuffer(secretKey)) secretKey = Buffer.from(secretKey, 'hex')
    if (!Buffer.isBuffer(message)) message = Buffer.from(message)
    const cipher = sodium.sodium_malloc(message.length + sodium.crypto_secretbox_MACBYTES)
    const nonce = randomBytes(sodium.crypto_secretbox_NONCEBYTES)
    sodium.crypto_secretbox_easy(cipher, message, nonce, secretKey)
    return Buffer.concat([nonce, cipher])
  },

  secretUnbox (cipherWithNonce, secretKey) {
    if (!Buffer.isBuffer(secretKey)) secretKey = Buffer.from(secretKey, 'hex')
    const nonce = cipherWithNonce.slice(0, sodium.crypto_secretbox_NONCEBYTES)
    const cipher = cipherWithNonce.slice(sodium.crypto_secretbox_NONCEBYTES)
    const message = sodium.sodium_malloc(cipher.length - sodium.crypto_secretbox_MACBYTES)
    const success = sodium.crypto_secretbox_open_easy(message, cipher, nonce, secretKey)
    return success ? message : false
  },

  signDetached (message, secretKey) {
    const sig = Buffer.alloc(sodium.crypto_sign_BYTES)
    sodium.crypto_sign_detached(sig, message, secretKey)
    return sig
  },

  verify (sig, message, publicKey) {
    return sodium.crypto_sign_verify_detached(sig, message, publicKey)
  },

  keypair () {
    const publicKey = sodium.sodium_malloc(sodium.crypto_sign_PUBLICKEYBYTES)
    const secretKey = sodium.sodium_malloc(sodium.crypto_sign_SECRETKEYBYTES)
    sodium.crypto_sign_keypair(publicKey, secretKey)

    return {
      publicKey,
      secretKey
    }
  }
}
