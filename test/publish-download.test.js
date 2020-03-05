const test = require('tape')
const { publish, download } = require('../transfer/hypercore-sendfile')
const tmpDir = require('tmp').dirSync
const path = require('path')
const pathToTestMedia = path.join(path.resolve(__dirname), './test-media')
const fs = require('fs')
const sodium = require('sodium-native')

test('publish', t => {
  const filename = 'big.mp4'
  const file = path.join(pathToTestMedia, filename)
  hashFile(file, (err, hashBuffer, size) => {
    t.error(err)
    const fileObjects = [{
      file,
      hash: hashBuffer.toString('hex'),
      size
    }]
    const downloadPath = path.join(tmpDir().name, filename)
    publish(fileObjects, null, (err, feedKey, feedSwarm) => {
      t.error(err, 'No error on publish')
      t.ok(feedKey, 'gives feed key')
      download(feedKey, downloadPath, size, onDownload, (err) => {
        t.error(err, 'No error on dowload')
      })
      function onDownload (hashToCheck) {
        t.ok(hashToCheck, 'gives hash')
        t.equal(hashToCheck.toString('hex'), fileObjects[0].hash, 'hashes match - correct data downloaded')
        const content = fs.readFileSync(downloadPath, 'utf8')
        console.log(content.length)
        t.end()
      }
    })
  })
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
