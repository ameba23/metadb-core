const LineReader = require('readline')
const fs = require('fs')
const path = require('path')
const { promisify } = require('util')

// When indexing, ignore particular files
// So we can have a file similar to .gitignore

const defaultContents = `# Files not to index:
*.exe
Desktop.ini
thumbs.db
Thumbs.db
*.part
`

module.exports = async function (storage) {
  const filename = path.join(storage, 'ignore')
  await promisify(fs.stat)(filename).catch(async (err) => {
    if (err.code === 'ENOENT') {
      await promisify(fs.writeFile)(filename, defaultContents)
    }
  })

  const ignore = []
  const lineReader = LineReader.createInterface({
    input: fs.createReadStream(filename)
  })

  return new Promise((resolve, reject) => {
    lineReader.on('line', (line) => {
      // # is a comment
      if (line.length && line[0] !== '#') ignore.push(line)
    })
    lineReader.on('close', () => {
      resolve(ignore)
    })
    lineReader.on('error', reject)
  })
}
