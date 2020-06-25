const validator = require('is-my-json-valid')
const VERSION = '1.0.0'

const version = { required: true, type: 'string', pattern: VERSION }
const timestamp = { required: true, type: 'number' } // TODO: realistic range
const type = (messageType) => { return { required: true, type: 'string', pattern: `^${messageType}$` } }
const recipients = {
  type: 'array',
  maxItems: 7,
  minItems: 1,
  items: {
    type: 'string'
    // TODO: regex
  }
}

const isAbout = validator({
  $schema: 'http://json-schema.org/schema#',
  type: 'object',
  properties: {
    type: type('about'),
    version,
    timestamp,
    name: {
      type: 'string',
      required: true
    }
  }
})

const isInvite = validator({
  $schema: 'http://json-schema.org/schema#',
  type: 'object',
  properties: {
    type: type('invite'),
    version,
    timestamp,
    link: {
      required: true,
      type: 'string'
      // TODO regex
    },
    recipients
  }
})

const isFileComment = validator({
  $schema: 'http://json-schema.org/schema#',
  type: 'object',
  properties: {
    type: type('file-comment'),
    version,
    timestamp,
    sha256: {
      required: true,
      type: 'string'
    },
    comment: {
      required: false,
      type: 'string'
    },
    star: {
      required: false,
      type: 'boolean'
    },
    unstar: {
      required: false,
      type: 'boolean'
    }
  }
})

const isAddFile = validator({
  $schema: 'http://json-schema.org/schema#',
  type: 'object',
  properties: {
    type: type('addFile'),
    version,
    timestamp,
    sha256: {
      required: true, // TODO should require some kind of hash, doesnt need to be sha256
      type: 'string'
    },
    filename: {
      required: true,
      type: 'string' // TODO dont allow the empty string
    },
    size: {
      required: false, // ?
      type: 'number' // TODO gt 0
    },
    metadata: {
      required: false,
      type: 'object' // TODO: specific fields eg: mimeType
    }
  }
})

// Assert that you no longer have the given files
const isRmFiles = validator({
  $schema: 'http://json-schema.org/schema#',
  type: 'object',
  properties: {
    type: type('rmFiles'),
    version,
    timestamp,
    files: {
      type: 'array',
      required: true,
      items: {
        type: 'string'
        // TODO: regex
      }
    }
  }
})

const isHeader = validator({
  $schema: 'http://json-schema.org/schema#',
  type: 'object',
  properties: {
    type: type('metadb-header'),
    version,
    timestamp
  }
})

module.exports = { isAbout, isInvite, isFileComment, isAddFile, isRmFiles, isHeader }
