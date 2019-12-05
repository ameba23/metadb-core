const LineReader = require('readline')
const fs = require('fs')
const minimatch = require('minimatch')

const filename = './metadb-ignore'
const ignore = []
var ready = false

module.exports = { setup, filesWeWant }

function setup (callback) {
  if (ready) return callback()
  const lineReader = LineReader.createInterface({ input: fs.createReadStream(filename) })
  lineReader.on('line', (line) => {
    ignore.push(line)
  })

  lineReader.on('close', () => {
    ready = true
    callback()
  })
}

function filesWeWant (file) {
  // TODO throw err if setup not run

  if (ignore.find(pat => minimatch(file, pat))) console.log('*********ingoring file ', file)
  return !ignore.find(pat => minimatch(file, pat))
}
