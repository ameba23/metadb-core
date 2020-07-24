const yaml = require('js-yaml')
const fs = require('fs')
const path = require('path')

const CONFIGFILE = (dir) => path.join(dir, 'config.yml')
const DEFAULT_CONFIG = `
# metadb config file
`

function save (metadb) {
  return function (callback) {
    fs.writeFile(CONFIGFILE(metadb.storage), yaml.safeDump(metadb.config, { sortKeys: true }), callback)
  }
}

function load (metadb) {
  return function (callback) {
    fs.readFile(CONFIGFILE(metadb.storage), 'utf8', (err, data) => {
      if (err) {
        if (err.code !== 'ENOENT') return callback(err)
        // Dont complain if the file doesnt exist - assume no config set
        // return fs.writeFile(CONFIGFILE(metadb.storage), DEFAULT_CONFIG, callback)
        return save(metadb)(callback)
      }
      metadb.config = yaml.safeLoad(data)
      callback()
    })
  }
}

module.exports = { save, load }
