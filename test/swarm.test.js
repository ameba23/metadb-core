const { describe } = require('tape-plus')
const Swarm = require('../lib/swarm')
const { keypair } = require('../lib/crypto')

const db = {
  put () {
  }
}

describe('basic', (context) => {
  context('connect to swarm', async (assert) => {
    const aliceKeypair = keypair()
    const bobKeypair = keypair()

    const alice = new Swarm(aliceKeypair, db)
    const bob = new Swarm(bobKeypair, db)

    await new Promise((resolve, reject) => {
      let countPeerEvents = 0
      alice.on('peer', (peerKey) => {
        assert.equals(Buffer.compare(peerKey, bobKeypair.publicKey), 0, 'alice gets bobs key')

        if (++countPeerEvents === 2) resolve()
      })
      bob.on('peer', (peerKey) => {
        assert.equals(Buffer.compare(peerKey, aliceKeypair.publicKey), 0, 'bob gets alices key')
        if (++countPeerEvents === 2) resolve()
      })
      alice.join('bananas')
      bob.join('bananas')
    })
    alice.leave('bananas')
    bob.leave('bananas')
    alice.destroy()
    bob.destroy()
  })
})
