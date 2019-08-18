const kappa = require('kappa-core')
const path = require('path')
const os = require('os')
const mkdirp = require('mkdirp')

const IndexFiles = require('./index-kappacore')
const QueryMfr = require('./query-mfr')
const PublishAbout = require('./publish-about')
const PublishRequest = require('./publish-request')
const PublishReply = require('./publish-reply');
const Swarm = require('./swarm')
const QueryFiles = require('./queries/query-files')
const QueryPeers = require('./queries/query-peers')
const Query = require('./queries/query')


class MetaDb {
  constructor (opts) {
    this.ready = false
    this.metaDbPath = opts.path || './metadb'
    // this will eventually be: path.join(os.homedir(), '.metadb')
    mkdirp.sync(this.metaDbPath)
    this.core = kappa(path.join(this.metaDbPath, 'db'), { valueEncoding: 'json' })
  }

  buildIndexes (cb) {
    return QueryMfr(this.core, this.metaDbPath)((err) => {
      if (err) cb(err)
      this.ready = true
      cb()
    })
  }

  indexFiles (dir, feedName, cb) { return IndexFiles(this.core)(dir, feedName, cb) }

  publishAbout (name, feedName, cb) { return PublishAbout(this.core)(name, feedName, cb) }

  publishRequest(files, recipients, feedName, cb) { return PublishRequest(this.core)(files, recipients, feedName, cb) }
  publishReply(key, recipient, feedname, cb) { return PublishReply(this.core)(key, recipient, feedName, cb) }
  queryFiles() { return QueryFiles(this.core)() }
  queryPeers() { return QueryPeers(this.core)() }
  query(query, opts) { return Query(this.core)(query, opts) }
}

module.exports = (opts) => new MetaDb(opts)

// module.exports.swarm = Swarm(core)



