const { Sha256 } = require('../crypto')

// Accept pieces of a file in whatever order they arrive, and hash them

module.exports = class HashPieces {
  constructor (position, hashState) {
    this.pieces = {}
    this.sha256 = new Sha256(hashState)
    this.position = position || 0
    this.bytesReceived = this.position
  }

  add (offset, data) {
    if (!this.pieces[offset]) this.bytesReceived += data.length

    this.pieces[offset] = data.length
    if (offset === this.position) {
      this.sha256.update(data)
      this.position += data.length
    }
  }

  // Takes a random-access-file instance
  async final (file) {
    for (const offsetString of Object.keys(this.pieces).sort()) {
      const offset = parseInt(offsetString)
      if (offset === this.position) {
        const length = this.pieces[offset]
        const data = await new Promise((resolve, reject) => {
          file.read(offset, length, (err, data) => {
            if (err) return reject(err)
            resolve(data)
          })
        })
        this.position += length
        console.log('[hash pieces] adding after', offset, data.length)
        this.sha256.update(data)
      }
    }
    return this.sha256.final()
  }
}
