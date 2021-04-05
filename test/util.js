const path = require('path')
const { tmpdir } = require('os')
const mkdirp = require('mkdirp').sync
const rimraf = require('rimraf')
const { randomBytes } = require('crypto')

class TestDir {
  constructor () {
    this.name = path.join(tmpdir(), randomBytes(4).toString('hex'))
    mkdirp(this.name)
  }

  delete () {
    rimraf.sync(this.name)
  }
}

module.exports = {
  TestDir,

  async iteratorToArray (iterator) {
    const entries = []
    for await (const entry of iterator) {
      entries.push(entry)
    }
    return entries
  }
}
