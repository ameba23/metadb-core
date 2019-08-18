const merge = require('deepmerge')
const pull = require('pull-stream')

const queryFiles = [
  { $filter: { value: { type: 'addFile' } } },
  { $reduce: {
    hash: ['value', 'id'],
    data: { $collect: 'value' },
    holders: { $collect: 'key' }
  } }
]

// console.log(core.api.query.explain({ live: false, reverse: true, query }))
module.exports = function (metaDb) {
  return function () { // opts?
    return pull(
      metaDb.query(queryFiles),
      pull.map(entry => {
        var mergeEntries = {}
        entry.data.forEach(thing => {
          mergeEntries = merge(thing, mergeEntries)
        })
        entry.data = mergeEntries
        return entry
      })
    )
  }
}
