const validator = require('is-my-json-valid')
const VERSION = '1.0.0'

const version = { required: true, type: 'string', pattern: VERSION }
const timestamp = { required: true, type: 'number' } // TODO: realistic range
const type = (messageType) => { return { required: true, type: 'string', pattern: `^${messageType}$` } }
const recipients = {
  type: 'array',
  maxItems: 7,
  minItems: 2,
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

const isRequest = validator({
  $schema: 'http://json-schema.org/schema#',
  type: 'object',
  properties: {
    type: type('request'),
    version,
    timestamp,
    files: {
      required: true,
      type: 'array',
      minItems: 1,
      // maxItems ?
      items: {
        type: 'string'
        // TODO: regex
      }
    },
    recipients
  }
})

const isReply = validator({
  $schema: 'http://json-schema.org/schema#',
  type: 'object',
  properties: {
    type: type('reply'),
    version,
    timestamp,
    key: {
      required: true,
      type: 'string'
      // TODO: regex
    },
    recipients
  }
})

module.exports = { isAbout, isRequest, isReply }
