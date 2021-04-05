const sublevel = require('subleveldown')
const Kappa = require('kappa-core')
const corestoreSource = require('kappa-core/sources/corestore')
const createFilesView = require('./files')
const createPeersView = require('./peers')
const createWallMessageView = require('./wall-message')
const log = require('debug')('metadb-kappa')

const STATE = 's'
const FILES = 'f'
const PEERS = 'p'
const WALL_MESSAGES = 'w'

// Manage views using kappa

module.exports = class Views {
  constructor (corestore, db) {
    this.kappa = new Kappa()
    // TODO can we use the same source for all
    const peerSource = corestoreSource({ store: corestore, db: sublevel(db, STATE) })
    const peerSource2 = corestoreSource({ store: corestore, db: sublevel(db, STATE) })
    const peerSource3 = corestoreSource({ store: corestore, db: sublevel(db, STATE) })
    this.kappa.use(
      'files',
      peerSource,
      createFilesView(sublevel(db, FILES, { valueEncoding: 'json' }))
    )
    this.kappa.use(
      'peers',
      peerSource2,
      createPeersView(sublevel(db, PEERS, { valueEncoding: 'json' }))
    )
    this.kappa.use(
      'wallMessages',
      peerSource3,
      createWallMessageView(sublevel(db, WALL_MESSAGES, { valueEncoding: 'json' }))
    )
    this.indexesReady = false
  }

  async ready () {
    log('Resuming indexing...')
    await new Promise((resolve, reject) => {
      this.kappa.ready(resolve)
      log('Indexes up to date')
    })
  }

  async pauseIndexing () {
    log('Pausing indexing...')
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
