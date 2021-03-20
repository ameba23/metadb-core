const test = require('tape')
const HashPieces = require('../lib/file-transfer/hash-pieces')
const raf = require('random-access-file')
const path = require('path')
const fs = require('fs')

const inputFile = path.join(path.resolve(__dirname), 'test-media', 'donkey.jpg')
const expectedHash = Buffer.from('843b5593e6e1f23daeefb66fa5e49ba7800f5a4b84c03c91fac7f18fb2a3663f', 'hex')

test('hashing works in normal order', async t => {
  const file = raf(inputFile)
  const hp = new HashPieces()
  let offset = 0
  for await (const chunk of fs.createReadStream(inputFile)) {
    hp.add(offset, chunk)
    offset += chunk.length
  }
  const sha256 = await hp.final(file)
  t.equals(Buffer.compare(sha256, expectedHash), 0, 'Expected hash')
  t.end()
})

test('hashing works in reverse order', async t => {
  const file = raf(inputFile)
  const hp = new HashPieces()
  let offset = 0
  const chunks = []
  for await (const chunk of fs.createReadStream(inputFile)) {
    chunks.push({ offset, chunk })
    offset += chunk.length
  }
  for (const { offset, chunk } of chunks.reverse()) {
    hp.add(offset, chunk)
  }
  const sha256 = await hp.final(file)
  t.equals(Buffer.compare(sha256, expectedHash), 0, 'Expected hash')
  t.end()
})

test('hashing works in reverse order, with a duplicate chunk sent', async t => {
  const file = raf(inputFile)
  const hp = new HashPieces()
  let offset = 0
  const chunks = []
  for await (const chunk of fs.createReadStream(inputFile)) {
    chunks.push({ offset, chunk })
    offset += chunk.length
  }
  for (const { offset, chunk } of chunks.reverse()) {
    hp.add(offset, chunk)
    hp.add(offset, chunk)
  }
  const sha256 = await hp.final(file)
  t.equals(Buffer.compare(sha256, expectedHash), 0, 'Expected hash')
  t.end()
})
