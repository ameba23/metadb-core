const exif = require('exiftool')
const { keysWeWant } = require('./exif-keys.json')

module.exports = function (data, callback) {
  exif.metadata(data, (err, metadata) => {
    if (err) return callback(err)
    callback(null, reduceMetadata(metadata))
  })
}

function reduceMetadata (metadataObj) {
  const reducedMetadata = {}
  Object.keys(metadataObj).forEach(key => {
    if ((keysWeWant.indexOf(key) > -1) && (metadataObj[key])) reducedMetadata[key] = metadataObj[key]
  })
  return reducedMetadata
}
