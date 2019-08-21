module.exports = {
  validator: (msg) => {
    if (!msg) return null
    if (typeof msg !== 'object') return null
    if (typeof msg.value !== 'object') return null
    // if (typeof msg.value.id !== 'string') return null
    if (typeof msg.value.type !== 'string') return null
    return msg
  },
  indexes: [
    { key: 'ddd', value: ['value', 'id'] },
    // indexes all messages from all feeds by timestamp
    { key: 'log', value: ['value', 'timestamp'] },
    // indexes all messages from all feeds by message type, then by timestamp
    { key: 'typ', value: [['value', 'type'], ['value', 'timestamp']] }
  ]
}
