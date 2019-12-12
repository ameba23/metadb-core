const FEED_KEY_LENGTH = 32
function readableBytes (bytes) {
  if (bytes < 1) return 0 + ' B'
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']

  return (bytes / Math.pow(1024, i)).toFixed(2) * 1 + ' ' + sizes[i]
}

function uniq (array) {
  if (!Array.isArray(array)) array = [array]
  return Array.from(new Set(array))
}

function isHexString (thing, length) {
  if (typeof thing !== 'string') return false
  if (length && (thing.length !== length)) return false
  return RegExp('[0-9a-fA-F]+').test(thing)
}

function isBranchRef (thing) {
  try {
    thing = thing.split('@')
    if (isHexString(thing[0], FEED_KEY_LENGTH) && parseInt(thing[1]) > -1) return true
  } catch (err) { return false }
}
module.exports = { readableBytes, uniq, isHexString, isBranchRef }
