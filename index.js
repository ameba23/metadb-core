const kappa = require('kappa-core')
const IndexFiles = require('./index-kappacore')
const QueryMfr = require('./query-mfr')
const PublishAbout = require('./publish-about')

var core = kappa('./multimetadb', { valueEncoding: 'json' })

module.exports.queryMfr = QueryMfr(core)
module.exports.indexFiles = IndexFiles(core)
module.exports.publishAbout = PublishAbout(core)

