function toString (bufOrString) {
  return typeof bufOrString === 'string' ? bufOrString : bufOrString.toString('hex')
}

function uniq (array) {
  if (!Array.isArray(array)) array = [array]
  return Array.from(new Set(array))
}

module.exports = {
  toString,
  uniq,

  printKey (buf) {
    return toString(buf).slice(0, 4)
  },

  readableBytes (bytes) {
    if (bytes < 1) return 0 + ' B'
    const i = Math.floor(Math.log(bytes) / Math.log(1024))
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']

    return (bytes / Math.pow(1024, i)).toFixed(2) * 1 + ' ' + sizes[i]
  },

  arrayMerge (destArray, sourceArray) {
    return uniq(destArray.concat(sourceArray))
  }
}
