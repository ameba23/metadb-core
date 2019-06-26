const exif = require('exiftool')
const fs = require('fs')
const pull = require('pull-stream')
const path = require('path')
const glob = require('glob')
const kappa = require('kappa-core')
const { sha256 } = require('./crypto')
// const isEqual = require('lodash.isequal')

const dir = process.argv[2] // './stuff'

var core = kappa('./multimetadb', {valueEncoding: 'json'})

var dataAdded = 0

core.writer('local', function (err, feed) {
  if (err) throw err
  glob('**/*', {cwd: dir, nodir: true}, (err, files) => {
    if (err) throw err
    pull(
      pull.values(files),
      pull.asyncMap((file, cb) => {
        fs.readFile(path.join(dir, file), function (err, data) {
          if (err) return cb(err)
          const hash = sha256(data).toString('hex')
          console.log('hash ', hash)
          console.log('Extracting metadata from file ', file, ' of length ', data.length)
          exif.metadata(data, (err, metadata) => {
            if (err) return cb(err)
            const metadataObj = Object.assign({}, metadata)
            var newEntry = {
              id: file,
              hash,
              metadata: metadataObj
            }
            var duplicate = false
            // check if an identical entry exists in the feed
            const feedStream = feed.createReadStream({ live: false })
            feedStream.on('data', (data) => {
              delete data.added
              // if (isEqual(newEntry, data)) { //lodash doesnt seem to work here
              if (JSON.stringify(data) === JSON.stringify(newEntry)) { // bad solution
                duplicate = true
                console.log('found a match')
                feedStream.destroy()
                cb(null, metadataObj)
              }
            })
            feedStream.on('end', () => {
              if (!duplicate) {
                newEntry.added = new Date().toISOString()
                feed.append(newEntry, (err, seq) => {
                  if (err) throw err
                  console.log('Data was appended as entry #' + seq)
                  dataAdded += 1
                  cb(null, metadataObj)
                })
              }
            })
          })
        })
      }),
      pull.collect((err, datas) => {
        if (err) throw err
        console.log('Number of metadata parsed: ', datas.length)
        console.log('Number of metadata added: ', dataAdded)
        // console.log('datas',JSON.stringify(datas, null,4))
      })
    )
  })
})
