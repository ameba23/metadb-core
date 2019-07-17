const exif = require('exiftool')
const fs = require('fs')
const pull = require('pull-stream')
const chalk = require('chalk')
const path = require('path')
const glob = require('glob')
const { keysWeWant } = require('./exif-keys.json')
const { sha256 } = require('./crypto')
const { readableBytes } = require('./util')


module.exports = function indexKappa(core) {
  return function (dir, feedName) {
    feedName = feedName || 'local'
    var dataAdded = 0

    core.writer(feedName, (err, feed) => {
      if (err) throw err
      console.log('Scanning directory ', dir, '...')
      glob('**/*', {cwd: dir, nodir: true}, (err, files) => {
        if (err) throw err
        pull(
          pull.values(files),
          pull.asyncMap((file, cb) => {
            fs.readFile(path.join(dir, file), function (err, data) {
              if (err) return cb(err)
              const hash = sha256(data).toString('base64') + '.sha256'
              console.log(
                'Extracting metadata from file: ',
                chalk.green(file),
                ' of length ',
                chalk.green(readableBytes(data.length)),
                chalk.blue(hash)
              )
              exif.metadata(data, (err, metadata) => {
                if (err) return cb(err)
                const metadataObj = Object.assign({}, metadata)
                var newEntry = {
                  type: 'addFile',
                  id: hash,
                  filename: file,
                  metadata: reduceMetadata(metadataObj)
                }
                var duplicate = false
                // check if an identical entry exists in the feed
                const feedStream = feed.createReadStream({ live: false })
                feedStream.on('data', (data) => {
                  delete data.timestamp
                  // if (isEqual(newEntry, data)) { //lodash doesnt seem to work here
                  // TODO: use deepmerge
                  if (JSON.stringify(data) === JSON.stringify(newEntry)) { // bad solution
                    duplicate = true
                    console.log(chalk.red('File already exists in index, skipping...'))
                    feedStream.destroy()
                    cb(null, metadataObj)
                  }
                })
                feedStream.on('end', () => {
                  if (!duplicate) {
                    newEntry.timestamp = Date.now()
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
            console.log('Feed ', chalk.green(feedName), ' with key ', chalk.green(feed.key.toString('hex')))
            console.log('Number of metadata parsed: ', chalk.green(datas.length))
            console.log('Number of metadata added: ', chalk.green(dataAdded))
            // console.log('datas',JSON.stringify(datas, null,4))
          })
        )
      })
    })
  }
}


function reduceMetadata (metadataObj) {
  const reducedMetadata = {}
  Object.keys(metadataObj).forEach(key => {
    if ((keysWeWant.indexOf(key) > -1) && (metadataObj[key])) reducedMetadata[key] = metadataObj[key]
  })
  return reducedMetadata
}

