const LineReader = require('readline')
const fs = require('fs')
const minimatch = require('minimatch')
const path = require('path')
const log = require('debug')('metadb-ignore')

const filename = path.join(path.resolve(__dirname), '../metadb-ignore')
const ignore = []
var ready = false

// When indexing, ignore particular files using 'minimatch'
// So we can have a file similar to .gitignore
// TODO should be a class

module.exports = { setup, filesWeWant }

function setup (callback) {
  if (ready) return callback()
  const lineReader = LineReader.createInterface({ input: fs.createReadStream(filename) })
  lineReader.on('line', (line) => {
    // # is a comment
    if (line.length && line[0] !== '#') ignore.push(line)
  })

  lineReader.on('close', () => {
    ready = true
    callback()
  })
  lineReader.on('error', callback)
}

function filesWeWant (file) {
  if (!ready) throw new Error('Ignore not set up')

  if (ignore.find(pat => minimatch(file, pat))) log('Ignoring file from ignore list', file)
  return !ignore.find(pat => minimatch(file, pat))
}
