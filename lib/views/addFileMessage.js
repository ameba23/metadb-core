const { arrayMerge } = require('../util')
const merge = require('deepmerge')
const HASH = 'h!'
const PATH = 'p!'
const HOLDER = 'o!'
const TIMESTAMP = 't!'

// Index an 'addFile' message from a feed

module.exports = async function (msg, level, totals) {
  msg.value.addFile.sha256 = msg.value.addFile.sha256.toString('hex')
  if (msg.value.addFile.metadata && typeof msg.value.addFile.metadata === 'string') {
    msg.value.addFile.metadata = JSON.parse(msg.value.addFile.metadata)
  }
  const sha256 = msg.value.addFile.sha256

  let merged = msg.value.addFile
  const existingValue = await level.get(HASH + sha256)
    .catch(() => { return undefined })

  if (existingValue) {
    msg.value.addFile.filename = [msg.value.addFile.filename]
    // TODO: this will clobber old values
    merged = merge(existingValue, msg.value.addFile, { arrayMerge })
  }

  merged.holders = merged.holders || []
  if (!merged.holders.includes(msg.key)) merged.holders.push(msg.key)

  totals.files += 1
  totals.bytes += merged.size
  merged.holders.forEach((holder) => {
    totals.holders[holder] = totals.holders[holder] || { files: 0, bytes: 0 }
    totals.holders[holder].files += 1
    totals.holders[holder].bytes += merged.size
  })

  return [{
    type: 'put',
    key: HASH + sha256,
    value: merged
  },
  {
    type: 'put',
    key: PATH + msg.value.addFile.filename + '!' + msg.value.timestamp,
    value: sha256
  },
  {
    type: 'put',
    // key: HOLDER + msg.key + '@' + msg.seq,
    key: HOLDER + msg.key + '!' + msg.value.addFile.filename, // + '!' + msg.seq,
    value: sha256
  },
  {
    type: 'put',
    key: TIMESTAMP + msg.value.timestamp + '!' + sha256,
    value: 0
  }]
}
