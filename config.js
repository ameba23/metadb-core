const yaml = require('js-yaml')
const fs = require('fs')
const path = require('path')

const CONFIGFILE = (dir) => path.join(dir, 'config.yml')

function save (metadb) {
  return function (callback) {
    fs.writeFile(CONFIGFILE(metadb.storage), yaml.safeDump(metadb.config, { sortKeys: true }), callback)
  }
}

function load (metadb) {
  return function (callback) {
    fs.readFile(CONFIGFILE(metadb.storage), 'utf8', (err, data) => {
      if (err) {
        // Dont complain if the file doesnt exist - assume no config set
        return (err.code === 'ENOENT')
          ? callback()
          : callback(err)
      }
      metadb.config = yaml.safeLoad(data)
      callback()
    })
  }
}

module.exports = { save, load }
