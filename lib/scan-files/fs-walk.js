const fs = require('fs')
const path = require('path')
const micromatch = require('micromatch')
const { promisify } = require('util')

// A filesystem walk designed to favour saving memory over speed
// (designed for large directories)

// TODO currently will not follow symbolic links
// if (file.isSymbolicLink()) {
//   fs.stat(fullPath, (err, stats) => {
//     if (err) return cb(err)
//     if (stats.isDirectory()) return cb(null, fullPath)
//   })
// }

module.exports = async function * (baseDir, options = {}) {
  const ignorePatterns = options.ignorePatterns || []
  if (baseDir[baseDir.length - 1] !== path.sep) baseDir = baseDir + path.sep
  yield * getFiles(baseDir)

  async function * getFiles (directory) {
    if (micromatch.isMatch(directory, ignorePatterns)) return
    const files = await promisify(fs.readdir)(directory, { withFileTypes: true })

    for await (const f of files) {
      if (micromatch.isMatch(f.name, ignorePatterns)) return
      const fullPath = path.join(directory, f.name)
      if (f.isFile()) yield fullPath.slice(baseDir.length)
      if (f.isDirectory()) yield * getFiles(fullPath)
    }
  }
}
