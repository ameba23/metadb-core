#!/usr/bin/env node
const yargs = require('yargs')

const metadb = require('.')

const yargsargs = processCommand()
if (!yargsargs._[0]) yargs.showHelp()

function callback (err, res) {
  if (err) throw err
  console.log(res)
}

function processCommand () {
  return yargs
    .command('index <directory>', 'index a directory', (yargs) => {
      yargs
        .positional('directory', {
          describe: 'directory to scan',
          type: 'string'
        })
        .option('feedname', {
          demandOption: false,
          type: 'string'
        })
    }, (argv) => {
      metadb.indexFiles(argv.directory, argv.feedname)
    })

    .command('name <name>', 'give yourself a name', (yargs) => {
      yargs
        .positional('name', {
          describe: 'a name',
          type: 'string'
        })
        .option('feedname', {
          demandOption: false,
          type: 'string'
        })
    }, (argv) => {
      metadb.publishAbout(argv.name, argv.feedname, callback)
    })

    .command('query', 'run a query', (yargs) => {
      yargs
        .option('query', {
          describe: 'the query',
          type: 'object'
        })
        .option('feedname', {
          demandOption: false,
          type: 'string'
        })
    }, (argv) => {
      metadb.queryMfr(argv.query, argv.feedname, callback)
    })
    .argv
}
