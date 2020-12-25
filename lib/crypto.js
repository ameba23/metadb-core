const sodium = require('sodium-native')

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
  }
}
