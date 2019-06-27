const exif = require('exiftool')
const fs = require('fs')
const pull = require('pull-stream')
const path = require('path')
const glob = require('glob')
const level = require('level')
const mkdirp = require('mkdirp')

const dir = '../../photos'

mkdirp.sync('db')
const db = level('db')

glob('**/*', {cwd: dir, nodir: true}, (err, files) => {
  if (err) throw err
  pull(
    pull.values(files),
    pull.asyncMap((file, cb) => {
      fs.readFile(path.join(dir, file), function (err, data) {
        if (err) return cb(err)
        console.log('fffff', file, data.length)
        exif.metadata(data, (err, metadata) => {
          if (err) return cb(err)
          const metadataObj = Object.assign({}, metadata)
          db.put(file, metadataObj, { valueEncoding: 'json' }, (err) => {
            if (err) return cb(err)
            db.get(file, { valueEncoding:'json' }, (err, someData) => {
              if (err) return cb(err)
              console.log(JSON.stringify(someData, null, 4))
              cb(null, metadata)
            })
          })
        })
      })
    }),
    pull.collect((err, datas) => {
      if (err) throw err
      console.log('number of metadata', datas.length)
      // console.log('datas',JSON.stringify(datas, null,4))
    })
  )
})
