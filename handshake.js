const crypto = require('./crypto')
const assert = require('assert')
const sodium = require('sodium-native')
const log = console.log
const concat = Buffer.concat
const EPHPKLENGTH = sodium.crypto_scalarmult_BYTES
const SECONDPASSLENGTH = sodium.crypto_sign_PUBLICKEYBYTES + sodium.crypto_sign_BYTES + sodium.crypto_secretbox_MACBYTES

// Handshake - ephemeral keys are exchanged, then public signing keys along with a  fresh signature

// The swarm key is added to prove that both parties know the 'key' of the swarm
// hypercore protocol already does this, but the way multifeed
// works would mean we would need a multifeed instance for each swarm
// we connect to.

// Using notation from the secret handshake paper (Dominic Tarr)
//   lowercase a b = ephemeral keys
//   uppercase A B = static keys (in our case signing keys)
//   a.b = scalar multiplication (diffie hellman)
//   | = concatonation
//   k = hash(swarmkey, applicationkey) application key contains handshake version number

// a: box[k] ( a )
// b: box[k] ( b )
// a: box[k|a.b]     ( A | sign(a|b) )
// b: box[k|a.b|b.A] ( B | sign(a|b|A) )

module.exports = function (ourStaticKeypair, weAreInitiator, stream, swarmKey, callback) {
  const ephKeypair = curveKeypair()
  const sign = (message) => signDetached(message, ourStaticKeypair.secretKey)
  const send = stream.write
  let theirStaticPK

  // add handshake version number to key
  const key = crypto.genericHash(Buffer.from('metadb handshake version 0.0.1'), swarmKey)

  const messageHandler = function (data) {
    let theirEphPk
    try {
      if (data.length === EPHPKLENGTH + sodium.crypto_secretbox_MACBYTES) {
        // assume this is an ephemeral key
        theirEphPk = open(data, key)
        if (weAreInitiator) {
          // respond with 2nd pass
          const plain = concat([ourStaticKeypair.publicKey, sign(concat([ephKeypair.publickey, theirEphPk]))])
          const encryptionKey = crypto.genericHash(concat([key, scalar(ephKeypair.secretKey, theirEphPk)]))
          send(box(plain, encryptionKey))
        } else {
          // Respond with our eph key
          send(box(ephKeypair.publicKey, key))
        }
      } else {
        // Assume this is a second pass message
        assert(data.length === SECONDPASSLENGTH, 'Handshake failed') // TODO
        const encryptionKey = concat([
          key,
          scalar(ephKeypair.secretKey, theirEphPk),
          weAreInitiator ? Buffer.from('') : scalar(ephKeypair.secretKey, crypto.edToCurvePk(theirStaticPK))
        ])

        const plain = open(data, encryptionKey)
        theirStaticPK = plain.slice(0, sodium.crypto_sign_PUBLICKEYBYTES)
        const message = concat([
          theirEphPk,
          ephKeypair.publickey,
          weAreInitiator ? Buffer.from('') : ourStaticKeypair.publicKey
        ])
        assert(validate(plain.slice(sodium.crypto_sign_PUBLICKEYBYTES), message, theirStaticPK), 'could not validate signature')

        if (!weAreInitiator) {
          // Respond with 2nd pass
          const plain = concat([ourStaticKeypair.publicKey, sign(concat([ephKeypair.publickey, theirEphPk, theirStaticPK]))])
          const encryptionKey = crypto.genericHash(concat([key, scalar(ephKeypair.secretKey, theirEphPk), scalar(ephKeypair.secretKey, crypto.edToCurvePk(theirStaticPK))]))
          send(box(plain, encryptionKey))
        }

        // callback with success
        stream.removeListener('data', messageHandler)
        return callback(null, theirStaticPK)
      }
    } catch (err) {
      stream.removeListener('data', messageHandler)
      return callback(err)
    }
  }

  stream.on('data', messageHandler)
  if (weAreInitiator) send(box(ephKeypair.publicKey, key))
}

// Crypto:

function signDetached (message, secretKey) {
  const sig = Buffer.alloc(sodium.crypto_sign_BYTES)
  sodium.crypto_sign_detached(sig, message, secretKey)
  return sig
}

function validate (sig, message, pk) {
  return sodium.crypto_sign_verify_detached(sig, message, pk)
}

function curveKeypair () {
  const publicKey = sodium.sodium_malloc(sodium.crypto_kx_PUBLICKEYBYTES)
  const secretKey = sodium.sodium_malloc(sodium.crypto_kx_SECRETKEYBYTES)
  sodium.crypto_kx_keypair(publicKey, secretKey) // TODO check this
  return { publicKey, secretKey }
}

function box (plaintext, key) {
  const ciphertext = sodium.sodium_malloc(plaintext.length + sodium.crypto_secretbox_MACBYTES)
  const nonce = crypto.randomBytes(sodium.crypto_secretbox_NONCEBYTES)
  assert(key.length === sodium.crypto_secretbox_KEYBYTES, 'Key incorrect length')
  sodium.crypto_secretbox_easy(ciphertext, plaintext, nonce, key)
  return Buffer.concat([ciphertext, nonce])
}

function open (ciphertextWithNonce, key) {
  assert(key.length === sodium.crypto_secretbox_KEYBYTES, 'Key incorrect length')
  const ciphertextLength = ciphertextWithNonce.length - sodium.crypto_secretbox_NONCEBYTES
  const nonce = ciphertextWithNonce.slice(ciphertextLength)
  const ciphertext = ciphertextWithNonce.slice(0, ciphertextLength)
  const plaintext = sodium.sodium_malloc(ciphertext.length - sodium.crypto_secretbox_MACBYTES)
  const success = sodium.crypto_secretbox_open_easy(plaintext, ciphertext, nonce, key)
  if (success) return plaintext
  return false
}

function scalar (sk, pk) {
  const result = sodium.sodium_malloc(sodium.crypto_scalarmult_BYTES)
  sodium.crypto_scalarmult(result, sk, pk)
  // TODO should we hash in pks here?
  return result
}
