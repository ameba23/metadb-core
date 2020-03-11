const test = require('tape')
const { publish, download } = require('../transfer/hypercore-sendfile')
const tmpDir = require('tmp').dirSync
const path = require('path')
const baseDir = path.join(path.resolve(__dirname), './test-media')
const fs = require('fs')
const sodium = require('sodium-native')
const pull = require('pull-stream')

test('publish', t => {
  const filenames = ['donkey.jpg', 'thumbs.db']

  pull(
    pull.values(filenames),
    pull.asyncMap((filename, cb) => {
      hashFile(path.join(baseDir, filename), (err, hashBuffer, size) => {
        if (err) cb(err)
        cb(null, {
          filename,
          hash: hashBuffer.toString('hex')
        })
      })
    }),
    pull.collect((err, fileObjects) => {
      t.error(err, 'No error on hashing test media files')

      const downloadPath = tmpDir().name

      const filenames = fileObjects.map(f => f.filename)
      publish(filenames, baseDir, (err, feedKey, feedSwarm) => {
        t.error(err, 'No error on publish')
        t.ok(feedKey, 'gives feed key')
        const hashes = fileObjects.map(f => f.hash)
        download(feedKey, downloadPath, hashes, onDownload, (err) => {
          t.error(err, 'No error on dowload')
        })

        function onDownload (verifiedHashes, badHashes) {
          t.equal(verifiedHashes.length, hashes.length, 'All hashes verified')
          t.notOk(badHashes.length, 'No bad hashes')
          // TODO verify files are there
          fs.readdir(downloadPath, (err, filesDownloaded) => {
            t.error(err, 'No error reading download path')
            console.log(filesDownloaded)
            t.end()
          })
          // const content = fs.readFileSync(downloadPath, 'utf8')
          // console.log(content.length)
        }
      })
    })
  )
})

function hashFile (filename, callback) {
  const hashInstance = sodium.crypto_hash_sha256_instance()
  const rs = fs.createReadStream(filename)
  let size = 0
  rs.on('data', (chunk) => {
    hashInstance.update(chunk)
    size += chunk.length
  })
  rs.once('end', () => {
    const hashBuffer = sodium.sodium_malloc(sodium.crypto_hash_sha256_BYTES)
    hashInstance.final(hashBuffer)
    console.log('Hash buffer', hashBuffer.toString('hex'))
    callback(null, hashBuffer, size)
  })
}
