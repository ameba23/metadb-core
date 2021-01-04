const test = require('tape')
const walk = require('../lib/scan-files/fs-walk')
const path = require('path')

const pathToWalk = path.join(path.resolve(__dirname), './test-media')
// const pathToWalk = path.join(path.resolve(__dirname), '..')

test('finds all files in given dir', async t => {
  const found = []
  for await (const f of walk(pathToWalk, { ignorePatterns: ['yarn.lock', 'test', 'node_modules'] })) {
    found.push(f)
  }
  t.equals(found.length, 2, 'correct number of files')
  t.true(found.includes('donkey.jpg'), 'correct file')
  t.true(found.includes('someDir/sometext.txt'), 'correct file')
  t.end()
})
