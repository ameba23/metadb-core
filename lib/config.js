const yaml = require('js-yaml')
const fs = require('fs')
const path = require('path')
const { promisify } = require('util')

const DEFAULT_CONFIG = '# metadb config file\n'
const writeFile = promisify(fs.writeFile)
const readFile = promisify(fs.readFile)

module.exports = class {
  constructor (storage) {
    this.configFile = path.join(storage, 'config.yml')
  }

  async save (config) {
    writeFile(this.configFile, yaml.safeDump(config, { sortKeys: true }))
  }

  async load () {
    const data = await readFile(this.configFile, 'utf8')
      .catch(async (err) => {
        if (err.code !== 'ENOENT') return Promise.reject(err)
        await writeFile(this.configFile, DEFAULT_CONFIG)
        return Buffer.from('')
      })
    return Object.assign({ configFile: this.configFile }, yaml.safeLoad(data))
  }
}
