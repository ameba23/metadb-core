// This file is auto generated by the protocol-buffers compiler

/* eslint-disable quotes */
/* eslint-disable indent */
/* eslint-disable no-redeclare */
/* eslint-disable camelcase */

// Remember to `npm install --save protocol-buffers-encodings`
var encodings = require('protocol-buffers-encodings')
var varint = encodings.varint
var skip = encodings.skip

var File = exports.File = {
  buffer: true,
  encodingLength: null,
  encode: null,
  decode: null
}

var Request = exports.Request = {
  buffer: true,
  encodingLength: null,
  encode: null,
  decode: null
}

var Unrequest = exports.Unrequest = {
  buffer: true,
  encodingLength: null,
  encode: null,
  decode: null
}

var Queued = exports.Queued = {
  buffer: true,
  encodingLength: null,
  encode: null,
  decode: null
}

defineFile()
defineRequest()
defineUnrequest()
defineQueued()

function defineFile () {
  File.encodingLength = encodingLength
  File.encode = encode
  File.decode = decode

  function encodingLength (obj) {
    var length = 0
    if (!defined(obj.hash)) throw new Error("hash is required")
    var len = encodings.bytes.encodingLength(obj.hash)
    length += 1 + len
    if (defined(obj.start)) {
      var len = encodings.varint.encodingLength(obj.start)
      length += 1 + len
    }
    if (defined(obj.length)) {
      var len = encodings.varint.encodingLength(obj.length)
      length += 1 + len
    }
    return length
  }

  function encode (obj, buf, offset) {
    if (!offset) offset = 0
    if (!buf) buf = Buffer.allocUnsafe(encodingLength(obj))
    var oldOffset = offset
    if (!defined(obj.hash)) throw new Error("hash is required")
    buf[offset++] = 10
    encodings.bytes.encode(obj.hash, buf, offset)
    offset += encodings.bytes.encode.bytes
    if (defined(obj.start)) {
      buf[offset++] = 16
      encodings.varint.encode(obj.start, buf, offset)
      offset += encodings.varint.encode.bytes
    }
    if (defined(obj.length)) {
      buf[offset++] = 24
      encodings.varint.encode(obj.length, buf, offset)
      offset += encodings.varint.encode.bytes
    }
    encode.bytes = offset - oldOffset
    return buf
  }

  function decode (buf, offset, end) {
    if (!offset) offset = 0
    if (!end) end = buf.length
    if (!(end <= buf.length && offset <= buf.length)) throw new Error("Decoded message is not valid")
    var oldOffset = offset
    var obj = {
      hash: null,
      start: 0,
      length: 0
    }
    var found0 = false
    while (true) {
      if (end <= offset) {
        if (!found0) throw new Error("Decoded message is not valid")
        decode.bytes = offset - oldOffset
        return obj
      }
      var prefix = varint.decode(buf, offset)
      offset += varint.decode.bytes
      var tag = prefix >> 3
      switch (tag) {
        case 1:
        obj.hash = encodings.bytes.decode(buf, offset)
        offset += encodings.bytes.decode.bytes
        found0 = true
        break
        case 2:
        obj.start = encodings.varint.decode(buf, offset)
        offset += encodings.varint.decode.bytes
        break
        case 3:
        obj.length = encodings.varint.decode(buf, offset)
        offset += encodings.varint.decode.bytes
        break
        default:
        offset = skip(prefix & 7, buf, offset)
      }
    }
  }
}

function defineRequest () {
  Request.encodingLength = encodingLength
  Request.encode = encode
  Request.decode = decode

  function encodingLength (obj) {
    var length = 0
    if (defined(obj.files)) {
      for (var i = 0; i < obj.files.length; i++) {
        if (!defined(obj.files[i])) continue
        var len = File.encodingLength(obj.files[i])
        length += varint.encodingLength(len)
        length += 1 + len
      }
    }
    return length
  }

  function encode (obj, buf, offset) {
    if (!offset) offset = 0
    if (!buf) buf = Buffer.allocUnsafe(encodingLength(obj))
    var oldOffset = offset
    if (defined(obj.files)) {
      for (var i = 0; i < obj.files.length; i++) {
        if (!defined(obj.files[i])) continue
        buf[offset++] = 10
        varint.encode(File.encodingLength(obj.files[i]), buf, offset)
        offset += varint.encode.bytes
        File.encode(obj.files[i], buf, offset)
        offset += File.encode.bytes
      }
    }
    encode.bytes = offset - oldOffset
    return buf
  }

  function decode (buf, offset, end) {
    if (!offset) offset = 0
    if (!end) end = buf.length
    if (!(end <= buf.length && offset <= buf.length)) throw new Error("Decoded message is not valid")
    var oldOffset = offset
    var obj = {
      files: []
    }
    while (true) {
      if (end <= offset) {
        decode.bytes = offset - oldOffset
        return obj
      }
      var prefix = varint.decode(buf, offset)
      offset += varint.decode.bytes
      var tag = prefix >> 3
      switch (tag) {
        case 1:
        var len = varint.decode(buf, offset)
        offset += varint.decode.bytes
        obj.files.push(File.decode(buf, offset, offset + len))
        offset += File.decode.bytes
        break
        default:
        offset = skip(prefix & 7, buf, offset)
      }
    }
  }
}

function defineUnrequest () {
  Unrequest.encodingLength = encodingLength
  Unrequest.encode = encode
  Unrequest.decode = decode

  function encodingLength (obj) {
    var length = 0
    if (defined(obj.files)) {
      for (var i = 0; i < obj.files.length; i++) {
        if (!defined(obj.files[i])) continue
        var len = File.encodingLength(obj.files[i])
        length += varint.encodingLength(len)
        length += 1 + len
      }
    }
    return length
  }

  function encode (obj, buf, offset) {
    if (!offset) offset = 0
    if (!buf) buf = Buffer.allocUnsafe(encodingLength(obj))
    var oldOffset = offset
    if (defined(obj.files)) {
      for (var i = 0; i < obj.files.length; i++) {
        if (!defined(obj.files[i])) continue
        buf[offset++] = 10
        varint.encode(File.encodingLength(obj.files[i]), buf, offset)
        offset += varint.encode.bytes
        File.encode(obj.files[i], buf, offset)
        offset += File.encode.bytes
      }
    }
    encode.bytes = offset - oldOffset
    return buf
  }

  function decode (buf, offset, end) {
    if (!offset) offset = 0
    if (!end) end = buf.length
    if (!(end <= buf.length && offset <= buf.length)) throw new Error("Decoded message is not valid")
    var oldOffset = offset
    var obj = {
      files: []
    }
    while (true) {
      if (end <= offset) {
        decode.bytes = offset - oldOffset
        return obj
      }
      var prefix = varint.decode(buf, offset)
      offset += varint.decode.bytes
      var tag = prefix >> 3
      switch (tag) {
        case 1:
        var len = varint.decode(buf, offset)
        offset += varint.decode.bytes
        obj.files.push(File.decode(buf, offset, offset + len))
        offset += File.decode.bytes
        break
        default:
        offset = skip(prefix & 7, buf, offset)
      }
    }
  }
}

function defineQueued () {
  Queued.encodingLength = encodingLength
  Queued.encode = encode
  Queued.decode = decode

  function encodingLength (obj) {
    var length = 0
    if (!defined(obj.queuePosition)) throw new Error("queuePosition is required")
    var len = encodings.varint.encodingLength(obj.queuePosition)
    length += 1 + len
    if (defined(obj.queueBytes)) {
      var len = encodings.varint.encodingLength(obj.queueBytes)
      length += 1 + len
    }
    if (defined(obj.queueFiles)) {
      var len = encodings.varint.encodingLength(obj.queueFiles)
      length += 1 + len
    }
    return length
  }

  function encode (obj, buf, offset) {
    if (!offset) offset = 0
    if (!buf) buf = Buffer.allocUnsafe(encodingLength(obj))
    var oldOffset = offset
    if (!defined(obj.queuePosition)) throw new Error("queuePosition is required")
    buf[offset++] = 8
    encodings.varint.encode(obj.queuePosition, buf, offset)
    offset += encodings.varint.encode.bytes
    if (defined(obj.queueBytes)) {
      buf[offset++] = 16
      encodings.varint.encode(obj.queueBytes, buf, offset)
      offset += encodings.varint.encode.bytes
    }
    if (defined(obj.queueFiles)) {
      buf[offset++] = 24
      encodings.varint.encode(obj.queueFiles, buf, offset)
      offset += encodings.varint.encode.bytes
    }
    encode.bytes = offset - oldOffset
    return buf
  }

  function decode (buf, offset, end) {
    if (!offset) offset = 0
    if (!end) end = buf.length
    if (!(end <= buf.length && offset <= buf.length)) throw new Error("Decoded message is not valid")
    var oldOffset = offset
    var obj = {
      queuePosition: 0,
      queueBytes: 0,
      queueFiles: 0
    }
    var found0 = false
    while (true) {
      if (end <= offset) {
        if (!found0) throw new Error("Decoded message is not valid")
        decode.bytes = offset - oldOffset
        return obj
      }
      var prefix = varint.decode(buf, offset)
      offset += varint.decode.bytes
      var tag = prefix >> 3
      switch (tag) {
        case 1:
        obj.queuePosition = encodings.varint.decode(buf, offset)
        offset += encodings.varint.decode.bytes
        found0 = true
        break
        case 2:
        obj.queueBytes = encodings.varint.decode(buf, offset)
        offset += encodings.varint.decode.bytes
        break
        case 3:
        obj.queueFiles = encodings.varint.decode(buf, offset)
        offset += encodings.varint.decode.bytes
        break
        default:
        offset = skip(prefix & 7, buf, offset)
      }
    }
  }
}

function defined (val) {
  return val !== null && val !== undefined && (typeof val !== 'number' || !isNaN(val))
}
