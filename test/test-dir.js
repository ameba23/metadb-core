const path = require('path')
const { tmpdir } = require('os')
const mkdirp = require('mkdirp').sync
const rimraf = require('rimraf')
const { randomBytes } = require('crypto')

module.exports = class TestDir {
  constructor () {
    this.name = path.join(tmpdir(), randomBytes(4).toString('hex'))
    mkdirp(this.name)
  }

  delete () {
    rimraf.sync(this.name)
  }
}
