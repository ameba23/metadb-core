const exif = require('exiftool')
const { keysWeWant } = require('./exif-keys.json')

module.exports = function (data, metadata, callback) {
  exif.metadata(data, (err, metadata) => {
    if (err) return callback(err)
    callback(null, reduceMetadata(metadata))
  })
}
// TODO binary option -b extracts 'picture' or 'thumbnail'

module.exports.isInstalled = function () {
  try {
    exif.metadata(Buffer.from(''), () => {})
  } catch (err) { return false }
  return true
}

function reduceMetadata (metadataObj) {
  const reducedMetadata = {}
  Object.keys(metadataObj).forEach(key => {
    if ((keysWeWant.indexOf(key) > -1) && (metadataObj[key])) reducedMetadata[key] = metadataObj[key]
  })
  return reducedMetadata
}
