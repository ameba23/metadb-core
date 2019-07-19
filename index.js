const kappa = require('kappa-core')
const path = require('path')
const os = require('os')
const mkdirp = require('mkdirp')

const IndexFiles = require('./index-kappacore')
const QueryMfr = require('./query-mfr')
const PublishAbout = require('./publish-about')
const Swarm = require('./swarm')

const METADB_PATH = './metadb'
// const METADB_PATH = path.join(os.homedir(), '.metadb')
mkdirp.sync(METADB_PATH)
const DB_PATH = path.join(METADB_PATH + '/db')

var core = kappa(DB_PATH, { valueEncoding: 'json' })

module.exports.queryMfr = QueryMfr(core, METADB_PATH)
module.exports.indexFiles = IndexFiles(core)
module.exports.publishAbout = PublishAbout(core)
module.exports.swarm = Swarm(core)
