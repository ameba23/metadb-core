const test = require('tape')
const tmpDir = require('tmp').dirSync
const path = require('path')
const fs = require('fs')
const multiplex = require('multiplex')
const FileTransfer = require('../lib/file-transfer/file-transfer')
const { randomBytes } = require('crypto')
const { pipeline } = require('stream')

const files = {
  '843b5593e6e1f23daeefb66fa5e49ba7800f5a4b84c03c91fac7f18fb2a3663f': 'donkey.jpg',
  '0396e1f8343aadf8b250e5a44a107af7162b1fd65fa14a42a9fbc2612d8efce5': 'somedir/atextfile.txt'
}

test('basic file transfer', t => {
  const alicePk = randomBytes(32)
  const bobPk = randomBytes(32)
  function createOptions (name) {
    return {
      downloadPath: tmpDir().name,
      hashesToFilenames: function (hash, cb) {
        const filePath = files[hash]

        if (!filePath) return cb(new Error('no file'))
        return cb(null, {
          hash,
          baseDir: path.join(path.resolve(__dirname), './test-media'),
          filePath
        })
      },
      log: function (data) {
        console.log(name, data)
      }
    }
  }
  const plex1 = multiplex()
  plex1.on('error', (err) => { throw err })
  const aliceStream = plex1.createSharedStream('metadb')
  const plex2 = multiplex()
  plex2.on('error', (err) => { throw err })
  const bobStream = plex2.createSharedStream('metadb')

  pipeline(
    plex1,
    plex2,
    plex1,
    (err) => {
      console.log(err, true)
    }
  )
  const alice = new FileTransfer(aliceStream, bobPk, createOptions('alice'))
  t.ok(alice, 'alice exists')
  const bob = new FileTransfer(bobStream, alicePk, createOptions('bob'))
  t.ok(bob, 'bob exists')
  alice.sendRequest(Object.keys(files)
    .map(f => { return { key: f, value: {} } })
  )
  alice.on('downloaded', (download) => {
    t.ok(download, 'alice downloaded file')
  })

  let verified = 0
  alice.on('verified', (sha256) => {
    t.ok(Object.keys(files).includes(sha256), 'alice successfully verified file')
    fs.stat(path.join(alice.downloadPath, files[sha256]), (err, stat) => {
      t.error(err, 'file exists')
    })
    if (++verified === Object.keys(files).length) {
      t.end()
    }
  })
})
