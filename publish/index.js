const PublishAbout = require('./publish-about')

module.exports = function Publish (metadb) {
  // const custom = publish
  return {
    about (name, cb) { return PublishAbout(metadb)(name, cb) },
    fileComment () { } // TODO
  }
}
