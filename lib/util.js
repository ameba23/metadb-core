const FEED_KEY_LENGTH = 32 // TODO require('sodium-native') get constant pk length

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

function isHexString (thing, lengthInBytes) {
  if (typeof thing !== 'string') return false
  if (lengthInBytes && (thing.length !== lengthInBytes * 2)) return false
  return RegExp('[0-9a-fA-F]+').test(thing)
}

function isBranchRef (thing) {
  try {
    thing = thing.split('@')
    if (isHexString(thing[0], FEED_KEY_LENGTH) && parseInt(thing[1]) > -1) return true
  } catch (err) { return false }
}

function packLinkGeneral (key, PREFIX) {
  if ((key.length === PREFIX.length + 32) && (key.slice(0, PREFIX.length) === PREFIX)) return key
  return PREFIX + key.toString('hex')
}

function unpackLinkGeneral (link, PREFIX) {
  return (link.slice(0, PREFIX.length) === PREFIX)
    ? Buffer.from(link.slice(PREFIX.length), 'hex')
    : false
}

module.exports = { readableBytes, uniq, isHexString, isBranchRef, packLinkGeneral, unpackLinkGeneral }
