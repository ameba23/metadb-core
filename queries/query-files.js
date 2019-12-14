const merge = require('deepmerge')
const pull = require('pull-stream')

// console.log(core.api.query.explain({ live: false, reverse: true, query }))
module.exports = function (metaDb) {
  return function () { // opts?
    const queryFiles = [
      { $filter: { value: { type: 'addFile' } } },
      {
        $reduce: {
          sha256: ['value', 'sha256'],
          data: { $collect: 'value' },
          holders: { $collect: 'key' }
        }
      }
    ]
    return pull(
      metaDb.query.custom(queryFiles),
      pull.map(entry => {
        var mergeEntries = {}
        entry.data.forEach(thing => {
          mergeEntries = merge(thing, mergeEntries)
        })
        entry.data = mergeEntries
        return entry
      }),
      pull.map(entry => {
        delete entry.data.type
        entry.data.holders = entry.holders
        return entry.data
      })
    )
  }
}
