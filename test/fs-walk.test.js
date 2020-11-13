const test = require('tape')
const walk = require('../lib/fs-walk')
const path = require('path')

const pathToWalk = path.join(path.resolve(__dirname), './test-media')

test('finds all files in given dir', t => {
  const foundPaths = []

  const op = (pathName, cb) => {
    setTimeout(() => {
      foundPaths.push(pathName)
      cb()
    }, 1)
  }
  walk(pathToWalk, op, { ignorePatterns: 'thumbs.db' }, (err) => {
    t.error(err, 'walk returns no err')
    console.log(foundPaths)
    t.end()
  })
})
