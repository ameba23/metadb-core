## metadb

**WIP**

based on an older project, [meta-database](https://github.com/ameba23/meta-database)
could be used to build a distributed db of media file metadata. 

- uses Exiftool to pull metadata from a given directory of files, publishes them to a kappa-core
- replicate with the database of others to produce a collective database of file metadata
- can build map-filter-reduce queries on the database to find things

Currently a command line tool - web interface coming soon

## Command line usage

`metadb index <directory>` - index a directory
`name <name>` - give yourself a name
`bin.js query`  - run a query

## API

### `queryMfr(query, callback)`
- `query` is an object

### `indexFiles(directory, feedName)`
- `directory` is a string with a path to some media files to be indexed
- `feedName` is an optional name for the feed (allowing multiple feeds on one machine for debugging purposes)

### `publishAbout(name, feedName)`
- `name` a string to identify yourself on the network (eg: 'alice')
- `feedName` is an optional name for the feed (allowing multiple feeds on one machine for debugging purposes)

## TODO
- a web interface (choo?) served to localhost
- run with 'forever' for swarming?
- private requests with `private-box`
- serve a requested file, publish a private reply with the discovery key 
