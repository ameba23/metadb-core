const kappa = require('kappa-core')
const path = require('path')
const os = require('os')
const mkdirp = require('mkdirp')
const private = require('kappa-private')
const level = require('level')
const Query = require('kappa-view-query')
const path = require('path')
const queryMfr = require('./query-mfr')

const IndexFiles = require('./index-kappacore')
const PublishAbout = require('./publish-about')
const PublishRequest = require('./publish-request')
const PublishReply = require('./publish-reply');
const Swarm = require('./swarm')
const QueryFiles = require('./queries/query-files')
const QueryPeers = require('./queries/query-peers')
const Query = require('./queries/query')

const LOCAL_FEED = 'local'
const VIEWS = (path) => path.join(path, 'views')

class MetaDb {
  constructor (opts) {
    this.ready = false
    this.metaDbPath = opts.path || './metadb'
    // this will eventually be: path.join(os.homedir(), '.metadb')
    mkdirp.sync(this.metaDbPath)
    this.asymmetric = new private.Asymmetric()
    this.core = kappa(path.join(this.metaDbPath, 'db'), { valueEncoding: asymmetric.encoder() })
    this.localKey = opts.key || null
  }

  getKeys (cb) {
    this.core.writer(LOCAL_FEED, (err, feed) => {
      if (err) return cb(err)
      feed.ready(() => {
        this.localKey = feed.key
        private.getSecretKey(storage, this.localKey, (err, secretKey) => {
          if (err) return cb(err)
          this.asymmetric.secretKey = secretKey
          cb()
        })
      })
    })
  }

  buildIndexes (cb) {
    this.db = level(VIEWS(this.metaDbPath))
    core.use('query', Query(db, this.core, queryMfr))
    core.ready(() => {
      // should we do if (this.key)
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
// module.exports.swarm = Swarm(metaDb)
}

module.exports = (opts) => new MetaDb(opts)

