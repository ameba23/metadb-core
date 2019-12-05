const sizeOf = require('image-size')

// extract image size
// there is no point in using this as well as exiftool, as it does the
// same thing. but this is pure js (no external deps)

module.exports = function (data, { mimeType }, callback) {
  // TODO: try catch ?
  callback(null, (mimeType && mimeType.split('/')[0] === 'image')
    ? { imageSize: sizeOf(data) }
    : null
  )
}
