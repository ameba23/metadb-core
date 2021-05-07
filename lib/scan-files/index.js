const defaultLog = require('debug')('metadb-scan')
const fs = require('fs')
const path = require('path')
const extract = require('metadata-extract')
const homeDir = require('os').homedir()
const { Sha256 } = require('../crypto')
const { readableBytes } = require('../util')
const walk = require('./fs-walk')
const { EventEmitter } = require('events')
const ignore = require('./ignore')

const MAXBATCH = 100

module.exports = class Shares extends EventEmitter {
  constructor (options = {}) {
    super()
    this.options = options
    this.shareTotalsStore = options.shareTotalsStore
    this.pauseIndexing = options.pauseIndexing || function () {}
    this.resumeIndexing = options.resumeIndexing || function () {}
    this.scanning = false
    this.sharedb = options.db
    this.indexQueueStore = options.indexQueueStore
    this.ignorePatterns = []
    this.log = options.log || defaultLog
  }

  async ready () {
    this.ignorePatterns = await ignore(this.options.storage)
    this.queue = await this.indexQueueStore.get('i').catch(() => { return [] })
  }

  async scanDir (dir, opts = {}) {
    const self = this
    if (dir === homeDir) return new Error('You may not index your entire home directory')

    if (!this.queue.includes(dir)) {
      this.queue.push(dir)
      this.saveQueue()
    }

    this.emit('start', { scanning: this.scanning })
    if (this.scanning) return false

    this.scanning = dir

    await this.pauseIndexing()

    const alreadyIndexed = await new Promise((resolve, reject) => {
      if (opts.rebuild) return resolve([])

      const indexed = []
      // Check for files already indexed
      this.sharedb.createValueStream()
        .on('data', (existingFile) => {
          if (existingFile.baseDir === dir) {
            indexed.push(existingFile.filePath)
          }
        })
        .on('error', reject) // TODO
        .on('end', () => {
          resolve(indexed)
        })
    })

    let filesAdded = 0
    let filesParsed = 0
    let bytesAdded = 0

    // metadb.emitWs({ indexingFiles: dir })
    this.log(`Scanning directory ${dir}...`)

    for await (const file of walk(dir, { ignorePatterns: this.ignorePatterns })) {
      filesParsed += 1
      this.log(`Scanning file: ${file}`)
      if (self.abortScanning) break

      // Periodically let the indexes catch up
      if (filesParsed % MAXBATCH === 0) await this.pauseIndexing()

      if (opts.rebuild || !alreadyIndexed.includes(file)) {
        const entry = await this.processFile(file).catch(() => { return undefined })
        if (entry) {
          filesAdded += 1
          bytesAdded += entry.size
          this.emit('entry', entry)
          await this.sharedb.put(entry.sha256.toString('hex'), { baseDir: dir, filePath: file })
        }
      } else {
        this.log('file already indexed, skipping')
      }
    }

    this.resumeIndexing()

    if (self.abortscanning) {
      self.abortScanning = false
      // metadb.emitWs({ indexingFiles: false })
      this.emit('abort')
      return
    }

    this.log(`Files parsed: ${filesParsed}`)
    this.log(`Files added: ${filesAdded}`)
    this.emit('finish', { filesParsed, filesAdded, bytesAdded })
    this.queue = this.queue.filter(d => d !== dir)

    await this.updateTotals(dir, filesAdded, bytesAdded)

    if (this.queue.length) {
      this.scanDir(this.queue.shift())
    } else {
      // metadb.emitWs({ indexingFiles: false })
      this.scanning = false
    }
    this.saveQueue()
    return { filesParsed, filesAdded, bytesAdded }
  }

  async processFile (file, options = {}) {
    const self = this
    const dir = this.scanning
    const fullPath = path.join(dir, file)
    const size = fs.statSync(fullPath).size
    if (!size) {
      this.log(`File ${file} has length 0. Skipping.`)
      return
    }

    const sha256 = new Sha256()

    const hash = await new Promise((resolve, reject) => {
      fs.createReadStream(fullPath)
        .on('data', (data) => {
          sha256.update(data)
        })
        .on('error', reject) // TODO
        .on('end', () => {
          resolve(sha256.final())
        })
    })
    // readStream.pipe(hashInstance)

    if (!options.skipExtraction) {
      self.log(
        `Extracting metadata from: ${file} length: ${readableBytes(size)} ${hash.slice(-4).toString('hex')}`
      )
    }
    const metadata = options.skipExtraction
      ? {}
      : extract(fullPath)

    return {
      sha256: hash,
      filename: file,
      size,
      metadata: JSON.stringify(metadata)
    }
  }

  pause () {
    this.abortScanning = true
  }

  resume () {
    if (this.queue.length) {
      this.scanDir(this.queue.shift())
      this.saveQueue()
    }
  }

  cancel (dir) {
    const dirs = dir
      ? Array.isArray(dir) ? dir : [dir]
      : this.queue

    this.queue = this.queue.filter(d => !dirs.includes(d))
    if (dirs.includes(this.scanning)) this.abortScanning = true

    // this.emitWs({ indexQueue: this.indexQueue })
    this.saveQueue()
  }

  async saveQueue () {
    return this.indexQueueStore.put('i', this.queue)
  }

  async updateTotals (dir, filesAdded, bytesAdded) {
    const existingEntry = await this.shareTotalsStore.get(dir)
      .catch(() => { return { numberFiles: 0, bytes: 0 } })
    const newEntry = {
      numberFiles: existingEntry.numberFiles + filesAdded,
      bytes: existingEntry.bytes + bytesAdded
    }
    await this.shareTotalsStore.put(dir, newEntry)
  }

  async * getShareTotals () {
    for await (const entry of this.shareTotalsStore.createReadStream()) {
      yield Object.assign({ dir: entry.key }, entry.value)
    }
  }
}

//     const isDuplicate = await checkForDuplicateEntries(newEntry)
//     if (isDuplicate) {
//       log('File already exists in index, skipping...')
//       return
//     }
//
//     metadb.publish.publishMessage(newEntry, 'addFile', (err, seq) => {
//       if (err) throw err // TODO
//       log('Data was appended as entry #' + seq)
//       metadb.emitWs({ sharedbUpdated: true })
//       dataAdded += 1
//       bytesAdded += size
//       metadb.sharedb.put(hash.toString('hex'), { baseDir: dir, filePath: file }, (err) => {
//         if (err) return cb(err)
//         cb()
//       })
//     })
//   }
