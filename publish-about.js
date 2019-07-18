module.exports = function (core) {
  return function about (name, feedName, callback) {
    feedName = feedName || 'local'
    var aboutMsg = {
      type: 'about',
      name
    }
    core.writer(feedName, (err, feed) => {
      aboutMsg.timestamp = Date.now()
      feed.append(aboutMsg, callback)
    })
  }
}
