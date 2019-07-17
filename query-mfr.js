const pull = require('pull-stream')
const level = require('level')
const Query = require('kappa-view-query')
const pump = require('pump')
const discovery = require('discovery-swarm')
const merge = require('deepmerge')

const db = level('./views')

// custom validator enabling you to write your own message schemas
const validator = function (msg) {
  if (typeof msg !== 'object') return null
  if (typeof msg.value !== 'object') return null
  if (typeof msg.value.id !== 'string') return null
  if (typeof msg.value.type !== 'string') return null
  return msg
}

const indexes = [
  { key: 'ddd', value: ['value', 'id'] },
  // indexes all messages from all feeds by timestamp
  { key: 'log', value: ['value', 'timestamp'] },
  // indexes all messages from all feeds by message type, then by timestamp
  { key: 'typ', value: [['value', 'type'], ['value', 'timestamp']] }
]


module.exports = function (core) {
  return function queryMfr (query) {
    core.use('query', Query(db, core, { indexes, validator }))

    var swarm = discovery()

    // TODO: change this
    swarm.join('mouse-p2p-app')

    core.ready(() => {
      const queryPeers = [
        { $filter: { value: { type: 'addFile' } } },
        { $reduce: {
          peerId: 'key',
          numberFiles: { $count: true }
        } }
      ]

      const queryFiles = [
        { $filter: { value: { type: 'addFile' } } },
        { $reduce: {
          hash: ['value', 'id'],
          data: { $collect: 'value' },
          holders: { $collect: 'key' }
        } }
      ]

      // console.log(core.api.query.explain({ live: false, reverse: true, query }))
      pull(
        core.api.query.read({ live: false, reverse: true, query: queryFiles }),
        pull.map(entry => {
          var mergeEntries = {}
          entry.data.forEach(thing => {
            mergeEntries = merge(thing, mergeEntries)
          })
          entry.data = mergeEntries
          console.log(entry)
          return entry
        }),
        pull.collect((err, entries) => {
          if (err) throw err
          console.log('Number of entries: ', entries.length)

          pull(
            core.api.query.read({ live: false, reverse: true, query: queryPeers }),
            pull.map(thing => {
              console.log(thing)
              return thing
            }),
            pull.collect((err, moose) => {
              if (err) throw err
              console.log(moose.length)
            })
          )
        })
      )
      swarm.on('connection', (connection, peer) => {
        console.log('new peer connected with key ', peer.id.toString('hex'))
        pump(connection, core.replicate({ live: true }), connection)
      })
    })
  }
}

