#!/usr/bin/env node
const yargs = require('yargs')
const pull = require('pull-stream')

const metadb = require('.')()

const yargsargs = processCommand()
if (!yargsargs._[0]) yargs.showHelp()

function callback (err, res) {
  if (err) throw err
  console.log(res)
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
      metadb.indexFiles(argv.directory, callback)
    })

    .command('name <name>', 'give yourself a name', (yargs) => {
      yargs
        .positional('name', {
          describe: 'a name',
          type: 'string'
        })
    }, (argv) => {
      metadb.publishAbout(argv.name, callback)
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
      metadb.buildIndexes(() => {
        pullback(metadb.query(argv.query))
      })
    })

    .command('query-files', 'list files in db', (yargs) => {
      yargs.option('opts', { demandOption: false })
    }, (argv) => {
      metadb.buildIndexes(() => {
        pullback(metadb.queryFiles())
      })
    })

    .command('query-peers', 'list known peers', (yargs) => {
      yargs.option('opts', { demandOption: false })
    }, (argv) => {
      metadb.buildIndexes(() => {
        pullback(metadb.queryPeers())
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
      metadb.swarm(argv.key)
    })

    .command('request', 'publish a request', (yargs) => {
      yargs
        .options('files', {
          describe: 'an array of file hashes that you want',
          demandOption: true,
          type: 'array'
        })
    }, (argv) => {
      metadb.publishRequest(argv.files)
    })

    .argv
}
