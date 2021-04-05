const HASH = 'h!'
const PATH = 'p!'
const HOLDER = 'o!'
const TIMESTAMP = 't!'
const COMMENTS = 'c!'
const STARS = 's!'

module.exports = async function rmFilesMessage (msg, level, totals) {
  const ops = []
  for (const sha256Buf of msg.value.rmFiles.files) {
    const sha256 = sha256Buf.toString('hex')
    const existingValue = await level.get(HASH + sha256).catch(() => { return undefined })
    if (!existingValue) continue
    existingValue.holders = existingValue.holders.filter(h => h !== msg.key)

    totals.holders[msg.key] = totals.holders[msg.key] || { files: 0, bytes: 0 }
    totals.holders[msg.key].files -= 1
    totals.holders[msg.key].bytes -= existingValue.size
    if (!existingValue.holders.length) {
      totals.files -= 1
      totals.bytes -= existingValue.size
    }

    ops.push({
      type: 'put',
      key: HASH + sha256,
      value: existingValue
    })

    for await (const entry of level.createReadStream({
      gte: HOLDER + msg.key,
      lte: HOLDER + msg.key + '~'
    })) {
      if (entry.value === sha256) {
        ops.push({
          type: 'del',
          key: entry.key
        })
        break
      }
    }

    // const filename = entry.key.split('!')[2]
    // if there are no more holders, find and rm related path and timestamp references
    // ops.push({
    //   type: 'del',
    //   key: PATH + msg.value.addFile.filename + '!' + msg.value.timestamp
    // })
    // ops.push({
    //   type: 'del',
    //   key: TIMESTAMP + msg.value.timestamp + '!' + sha256
    // })
  }

  return ops
}
