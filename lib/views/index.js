const sublevel = require('subleveldown')
const Kappa = require('kappa-core')
const corestoreSource = require('kappa-core/sources/corestore')
const createFilesView = require('./files')

const STATE = 's'
const FILES = 'f'

module.exports = class Views {
  constructor (corestore, db) {
    this.kappa = new Kappa()
    this.kappa.use(
      'files',
      corestoreSource({ store: corestore, db: sublevel(db, STATE) }),
      createFilesView(sublevel(db, FILES, { valueEncoding: 'json' }))
    )
    this.indexesReady = false

    this.filesInDb = 0
    this.bytesInDb = 0
    this.counters = {}
    // this.kappa.files.api.events.on('update', (totals) => {
    //   self.filesInDb += totals.files
    //   self.bytesInDb += totals.bytes
    //   Object.keys(totals.holders).forEach((holder) => {
    //     self.counters[holder] = self.counters[holder] || { files: 0, bytes: 0 }
    //     self.counters[holder].files += totals.holders[holder].files
    //     self.counters[holder].bytes += totals.holders[holder].bytes
    //   })
    // })
  }

  async ready () {
    await new Promise((resolve, reject) => {
      this.kappa.ready(resolve)
    })
    this.kappa.on('state-update', (name, state) => {
      console.log('state-update', name, state)
      // if (state.state === 'idle') self.emitWs({ dbIndexing: false })
      // if (state.state === 'indexing') self.emitWs({ dbIndexing: true })
    })
  }

  async pauseIndexing () {
    const self = this
    return new Promise((resolve, reject) => {
      self.kappa.resume()
      self.kappa.ready(() => {
        self.kappa.pause()
        resolve()
      })
    })
  }
}
