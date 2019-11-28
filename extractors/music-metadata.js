const mm = require('music-metadata')

// TODO music metadata can also parse streams - maybe this is better

// TODO: can add 'duration:true' but calculating it is expensive (whole file must be parsed)
// skipCovers: true stops covers being extracted
module.exports = function (data, mimetype, callback) {
  mm.parseBuffer(data, mimetype, {})
    .then((metadata) => {
      // console.log(util.inspect(metadata, { showHidden: false, depth: null }));
      callback(null, { 'music-metadata': metadata })
    })
}
