#!/usr/bin/env node
const yargs = require('yargs')
const pull = require('pull-stream')

const metadb = require('.')({ storage: yargs.argv.storage })

const yargsargs = processCommand()
if (!yargsargs._[0]) yargs.showHelp()

const log = console.log

function callback (err, res) {
  if (err) throw err
  if (res) console.log(JSON.stringify(res, null, 4))
}

function pullback (stream) {
  return pull(stream, pull.collect(callback))
}

function processCommand () {
  return yargs
    .command('index <directory>', 'index a directory', (yargs) => {
      yargs
        .positional('directory', {
          describe: 'directory to scan',
          type: 'string'
        })
    }, (argv) => {
      metadb.ready(() => {
        metadb.indexFiles(argv.directory, callback)
      })
    })

    .command('name <name>', 'give yourself a name', (yargs) => {
      yargs
        .positional('name', {
          describe: 'a name',
          type: 'string'
        })
    }, (argv) => {
      metadb.ready(() => {
        metadb.publish.about(argv.name, callback)
      })
    })

    .command('query', 'run a query', (yargs) => {
      yargs
        .option('query', {
          describe: 'the query object',
          type: 'object'
        })
        // .option('opts', {
        //   demandOption: false,
        //   type: 'object'
        // })
    }, (argv) => {
      metadb.ready(() => {
        metadb.buildIndexes(() => {
          pullback(metadb.query.custom(argv.query))
        })
      })
    })

    .command('query-files', 'list files in db', (yargs) => {
      yargs.option('opts', { demandOption: false })
    }, (argv) => {
      metadb.ready(() => {
        metadb.buildIndexes(() => {
          pullback(metadb.query.files())
        })
      })
    })

    .command('query-myfiles', 'list files in db indexed locally', (yargs) => {
    }, (argv) => {
      metadb.ready(() => {
        metadb.buildIndexes(() => {
          pullback(metadb.query.ownFiles())
        })
      })
    })
    .command('query-byExtention', 'list files with a particular extention', (yargs) => {
      yargs
        .option('opts', { demandOption: false })
        .option('extention', {
          describe: 'the extention',
          demandOption: true,
          type: 'string'
        })
    }, (argv) => {
      metadb.ready(() => {
        metadb.buildIndexes(() => {
          pullback(metadb.query.byExtention(argv.extention))
        })
      })
    })

    .command('substring', 'list files names containing a particular substring', (yargs) => {
      yargs
        .option('opts', { demandOption: false })
        .option('substring', {
          describe: 'the search term',
          demandOption: true,
          type: 'string'
        })
    }, (argv) => {
      metadb.ready(() => {
        metadb.buildIndexes(() => {
          pullback(metadb.query.filenameSubstring(argv.substring))
        })
      })
    })

    .command('subdir', 'list files in a given subdir', (yargs) => {
      yargs
        .option('subdir', {
          describe: 'the subdirectory',
          demandOption: true,
          type: 'string'
        })
    }, (argv) => {
      metadb.ready(() => {
        metadb.buildIndexes(() => {
          pullback(metadb.query.subdir(argv.subdir))
        })
      })
    })

    .command('query-peers', 'list known peers', (yargs) => {
      yargs.option('opts', { demandOption: false })
    }, (argv) => {
      metadb.ready(() => {
        metadb.buildIndexes(() => {
          metadb.query.peers(callback)
        })
      })
    })

    .command('connect', 'connect to other peers', (yargs) => {
      yargs
        .option('key', {
          describe: 'key to connect to',
          demandOption: false,
          type: 'string'
        })
    }, (argv) => {
      metadb.ready(() => {
        metadb.swarm(argv.key, callback)
      })
    })

    .command('disconnect', 'disconnect from other peers', (yargs) => {
      yargs
        .option('key', {
          describe: 'swarm to leave',
          demandOption: false,
          type: 'string'
        })
    }, (argv) => {
      metadb.unswarm(argv.key, callback)
    })

    .command('request', 'publish a request', (yargs) => {
      yargs
        .options('files', {
          describe: 'an array of file hashes that you want',
          demandOption: true,
          type: 'array'
        })
    }, (argv) => {
      metadb.ready(() => {
        metadb.publish.request(argv.files, callback)
      })
    })

    .argv
}
