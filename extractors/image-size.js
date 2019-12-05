const sizeOf = require('image-size')

module.exports = function (data, { mimeType }, callback) {
  // TODO: try catch ?
  callback(null, (mimeType && mimeType.split('/')[0] === 'image')
    ? { imageSize: sizeOf(data) }
    : null
  )
}
