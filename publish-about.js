module.exports = function (metaDb) {
  return function about (name, callback) {
    if (!metaDb.localFeed) return callback(new Error('No local feed'))
    var aboutMsg = {
      type: 'about',
      version: '1.0.0',
      name,
      timestamp: Date.now()
    }
    metaDb.localFeed.append(aboutMsg, callback)
  }
}
