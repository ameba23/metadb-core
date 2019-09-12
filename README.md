## metadb

**WIP**

Based on an older unfinished python project, [meta-database](https://github.com/ameba23/meta-database)
Could be used to build a distributed db of media file metadata. 

- uses kappa-core
- uses kappa-view-pull-query to do map-view-reduce queries of the kappa-core feeds
- uses kappa-private for encrypted messages between peers
- uses Exiftool to pull metadata from a given directory of files, publishes them to a kappa-core
- replicate with the database of others to produce a collective database of file metadata
- `exif-keys.json` specifies a list of attributes from exiftool that we would like to index

Currently a command line tool - web interface coming soon

## Command line usage

- `metadb connect [key]` - connect to a network and listen for peers. (leave this open in a separate terminal window)
- `metadb index <directory>` - index a directory
- `metadb name <name>` - give yourself a name
- `metadb bin.js query`  - run a query
- `rm -rf metadb` - delete the database and the view indexes

## API

```js
const MetaDb = require('metadb')
metaDb = MetaDb(options)
```
options is an optional argument containing an object with options:
- `options.path` - a string containing the desired directory to store the database

### `metaDb.ready(callback)`
callback is called when the db is initialised. callback takes no arguments.

### `indexFiles(directory, callback)`
- `directory` is a string with a path to some media files to be indexed

### `metaDb.buildIndexes(callback)`
callback is called when the indexes are built. callback takes no arguments. Queries cannot be run until this method has run.

### `metaDb.query(query, callback)`
Run a custom query
- `query` is an object

### `metaDb.publishAbout(name, callback)`
- `name` a string to identify yourself on the network (eg: 'alice')

### `metaDb.publishRequest(files, recipients, callback)`

Publish an encrypted request message to up to 7 other peers. 
- `files` is an array of strings which should be the hashes of the requested files
- `recipients` is an array of 32 byte buffers which should be the public keys of peers to send the request to.

### `metaDb.publishReply(key, recipient, callback)`

Publish a reply containing a dat link for the the requested files
- `key` should be a string containing a dat link
- `recipient` should be 32 bytes buffer which should be the public key of a single recipient

### `metaDb.swarm(key)`
- listen for peers on `key`, and replicate if you find any

## Issues
- exiftool started as a child process.  a native library would be better

## TODO
- handle query with no database
- a web interface (choo?) served to localhost
- run with 'forever' for swarming?
- yaml config file with shares
- assert validation
- serve a requested file, publish a private reply with the discovery key 
