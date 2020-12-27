const merge = require('deepmerge')
const { arrayMerge } = require('../util')

const HASH = 'h!'
const PATH = 'p!'
const HOLDER = 'o!'
const TIMESTAMP = 't!'
const COMMENTS = 'c!'
const STARS = 's!'

module.exports = async function fileCommentMessage (msg, level, totals) {
  const ops = []
  const sha256 = msg.value.fileComment.sha256.toString('hex')
  const fileComment = {
    metadata: {
      comments: msg.value.fileComment.comment.length
        ? [{ author: msg.key, comment: msg.value.fileComment.comment }]
        : [],
      stars: msg.value.fileComment.star ? [msg.key] : []
    }
  }
  if (msg.value.fileComment.extras.length) {
    fileComment.metadata = Object.assign(fileComment.metadata, JSON.parse(msg.value.fileComment.extras))
  }
  let merged = fileComment
  const existingValue = level.get(HASH + sha256).catch(() => { return undefined })
  if (existingValue) {
    merged = merge(existingValue, fileComment, { arrayMerge })

    // Remove star:
    if (msg.value.fileComment.unstar && merged.metadata.stars) {
      merged.metadata.stars = merged.metadata.stars.filter(h => h !== msg.key)

      for await (const entry of level.createReadStream({
        gte: STARS + msg.key,
        lte: STARS + msg.key + '~'
      })) {
        if (entry.value === sha256) {
          ops.push({
            type: 'del',
            key: entry.key
          })
          break
        }
      }
    }
  }
  ops.push({
    type: 'put',
    key: HASH + sha256,
    value: merged
  })
  if (msg.value.fileComment.comment.length) {
    ops.push({
      type: 'put',
      key: COMMENTS + msg.key + '!' + msg.value.timestamp,
      value: sha256
    })
  }
  if (msg.value.fileComment.star) {
    ops.push({
      type: 'put',
      key: STARS + msg.key + '!' + msg.value.timestamp,
      value: sha256
    })
  }
  return ops
}
