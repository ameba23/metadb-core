const exif = require('exiftool')
const fs = require('fs')
const pull = require('pull-stream')
const path = require('path')
const glob = require('glob')

const dir = './stuff'

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
          console.log(metadata)
          cb(null, metadata)
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
