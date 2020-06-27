module.exports = function Publish (metadb) {
  // const custom = publish

  function buildMessage (message, type) {
    return Object.assign({
      type,
      version: '1.0.0',
      timestamp: Date.now()
    }, message)
  }

  return {
    about (about, callback) {
      if (!metadb.localFeed) return callback(new Error('No local feed'))
      if (typeof about === 'string') about = { name: about }
      if (about.name === '') return callback(new Error('Cannot give empty string as name'))
      const aboutMsg = buildMessage(about, 'about')
      // TODO check isAbout
      metadb.localFeed.append(aboutMsg, callback)
    },
    fileComment (commentMessage, callback) {
      // TODO
      if (!metadb.localFeed) return callback(new Error('No local feed'))
      const message = buildMessage(commentMessage, 'fileComment')
      // if (!isFileComment(message)) return callback(new Error('Invalid comment message'))
      metadb.localFeed.append(message, callback)
    }
  }
}
