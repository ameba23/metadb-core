const PublishAbout = require('./publish-about')
const PublishRequest = require('./publish-request')
const PublishReply = require('./publish-reply')

module.exports = function Publish (metadb) {
  // const custom = publish
  return { about, request, reply, fileComment }

  function about (name, cb) { return PublishAbout(metadb)(name, cb) }
  function request (files, cb) { return PublishRequest(metadb)(files, cb) }
  function reply (...args) { return PublishReply(metadb)(...args) }
  function fileComment () {
    
  }
}
