const mm = require('music-metadata')

// TODO music metadata can also parse streams - maybe this is better

// TODO: can add 'duration:true' but calculating it is expensive (whole file must be parsed)
// skipCovers: true stops covers being extracted
module.exports = function (data, input, callback) {
  const mimeType = input.mimeType
  if (mimeType) {
    if (mimeType.split('/')[0] !== 'audio') return callback()
  } else {
    // TODO mimetype from extension
    if (!['mp3', 'flac'].includes(input.extension)) return callback()
  }
  mm.parseBuffer(data, mimeType, { skipCovers: true })
    .then((metadata) => {
      // console.log(util.inspect(metadata, { showHidden: false, depth: null }));
      callback(null, { 'music-metadata': metadata })
    }).catch((err) => {
      console.log(err)
      callback()
    })
}
