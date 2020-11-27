const test = require('tape')
const tmpDir = require('tmp').dirSync
const path = require('path')
// const pathToIndex = path.join(path.resolve(__dirname), './test-media')
const pull = require('pull-stream')
const FileTransfer = require('../lib/file-transfer/file-transfer')
const { randomBytes } = require('crypto')
const donkeyHash = '843b5593e6e1f23daeefb66fa5e49ba7800f5a4b84c03c91fac7f18fb2a3663f'
const { Duplex } = require('readable-stream')
const { pipeline } = require('stream')
const pump = require('pump')
const multiplex = require('multiplex')

test('basic file transfer', t => {
  // const log = debug(`metadb-file-transfer ${metadb.keyHex.slice(0, 4)}`)
  // options.downloadPath = metadb.config.downloadPath
  // options.getQueuePosition = function () {
  //   return metadb.uploadQueue.length
  // }
  const alicePk = randomBytes(32)
  const bobPk = randomBytes(32)
  function createOptions (name) {
    return {
      hashesToFilenames: function (hash, cb) {
        if (hash === donkeyHash) {
          return cb(null, {
            hash,
            baseDir: path.resolve(__dirname),
            filePath: './test-media/donkey.jpg'
          })
        }
      },
      log: function (data) {
        console.log(name, data)
      }
    }
  }
  // function createDuplexOptions (name) {
  //   return {
  //     write (chunk, enc, cb) {
  //       console.log(name, 'write', chunk.length)
  //       cb()
  //     },
  //     read (n) {
  //       console.log(name, 'read', n)
  //     }
  //   }
  // }
  // const aliceStream = new Duplex(createDuplexOptions('alice'))
  // const bobStream = new Duplex(createDuplexOptions('bob'))
  const plex1 = multiplex()
  plex1.on('error', (err) => {
    console.log('Error from multiplex', err)
  })
  const aliceStream = plex1.createSharedStream('metadb')
  const plex2 = multiplex()
  plex2.on('error', (err) => {
    console.log('Error from multiplex', err)
  })
  const bobStream = plex2.createSharedStream('metadb')
  bobStream.on('error', console.log)

  // aliceStream.on('data', (data) => {
  //   console.log('a', data.toString())
  // })
  // bobStream.on('data', (data) => {
  //   console.log('b', data.toString())
  // })
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
  setTimeout(() => {
    alice.sendRequest([{ key: donkeyHash, value: {} }])
    setTimeout(() => {
      t.end()
    }, 500)
  }, 500)
})
