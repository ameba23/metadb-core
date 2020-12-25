function toString (bufOrString) {
  return typeof bufOrString === 'string' ? bufOrString : bufOrString.toString('hex')
}

module.exports = {
  toString,

  printKey (buf) {
    return toString(buf).slice(0, 4)
  },

  uniq (array) {
    if (!Array.isArray(array)) array = [array]
    return Array.from(new Set(array))
  },

  readableBytes (bytes) {
    if (bytes < 1) return 0 + ' B'
    const i = Math.floor(Math.log(bytes) / Math.log(1024))
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']

    return (bytes / Math.pow(1024, i)).toFixed(2) * 1 + ' ' + sizes[i]
  }
}
