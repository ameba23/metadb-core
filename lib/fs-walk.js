const fs = require('fs')
const path = require('path')
const pull = require('pull-stream')
const micromatch = require('micromatch')

// A filesystem walk designed to favour saving memory over speed
// (designed for large directories)

// TODO currently will not follow symbolic links

module.exports = function (baseDir, operation, options = {}, callback) {
  const ignorePatterns = options.ignorePatterns || []
  if (baseDir[baseDir.length - 1] !== path.sep) baseDir = baseDir + path.sep

  return getFiles(baseDir, callback)

  function getFiles (directory, callback) {
    if (micromatch.isMatch(directory, ignorePatterns)) return callback()
    fs.readdir(directory, { withFileTypes: true }, function (err, files) {
      if (err) return callback(err)
      pull(
        pull.values(files),
        pull.asyncMap((file, cb) => {
          if (micromatch.isMatch(file.name, ignorePatterns)) return cb()
          const fullPath = path.join(directory, file.name)
          if (file.isDirectory()) return cb(null, fullPath)

          if (file.isFile()) return operation(fullPath.slice(baseDir.length), cb)
          // if (file.isSymbolicLink()) {
          //   fs.stat(fullPath, (err, stats) => {
          //     if (err) return cb(err)
          //     if (stats.isDirectory()) return cb(null, fullPath)
          //   })
          // }
          cb()
        }),
        pull.filter(Boolean),
        pull.collect((err, directories) => {
          if (err) return callback(err)
          pull(
            pull.values(directories),
            pull.asyncMap(getFiles),
            pull.drain(null, callback)
          )
        })
      )
    })
  }
}
