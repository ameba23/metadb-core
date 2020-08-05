const LineReader = require('readline')
const fs = require('fs')
const path = require('path')

// When indexing, ignore particular files
// So we can have a file similar to .gitignore

const defaultContents = `# Files not to index:
*.exe
thumbs.db
*.part
`

module.exports = function (storage, callback) {
  const filename = path.join(storage, 'ignore')
  fs.stat(filename, (err) => {
    if (err && err.code === 'ENOENT') {
      fs.writeFile(filename, defaultContents, (err) => {
        if (err) return callback(err)
        done()
      })
    } else done()
  })

  function done () {
    const ignore = []
    const lineReader = LineReader.createInterface({ input: fs.createReadStream(filename) })
    lineReader.on('line', (line) => {
      // # is a comment
      if (line.length && line[0] !== '#') ignore.push(line)
    })
    lineReader.on('close', () => {
      callback(null, ignore)
    })
    lineReader.on('error', (err) => {
      return callback(err)
    })
  }
}
