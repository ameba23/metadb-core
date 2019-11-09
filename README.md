## metadb

**WIP**

metadb is a peer-to-peer media file metadata database. Peers can extract information about their media files and replicate this data with other peers, to build a searchable distributed database of all known files.

There is also a system of sending encrypted requests for particular files, and responding to requests with a way of transferring them.

metadb aims to be transport agnostic - the focus of the project is on providing a metadata index - actual transfer of the files can be done by whichever protocol you choose: IPFS, DAT, Bittorrent, SCP, etc. This implementation contains a way to serve files as DAT archives, but any information can be included in a response to a request for a file, making it easy to plug in different transport mechanisms.

Based on an older unfinished python project, [meta-database](https://github.com/ameba23/meta-database)
Could be used to build a distributed db of media file metadata. 

- uses [kappa-core](https://github.com/kappa-db/kappa-core)
- uses [kappa-view-pull-query](https://www.npmjs.com/package/kappa-view-pull-query) to do map-view-reduce queries of the kappa-core feeds to [pull-streams](https://pull-stream.github.io/)
- uses [kappa-private](https://ledger-git.dyne.org/CoBox/kappa-private) for encrypted messages between peers
- uses [Exiftool](https://www.sno.phy.queensu.ca/~phil/exiftool/) to pull metadata from a given directory of files.  But metadata extraction is pluggable - it is easy to add additional tools to, for example, pull sample text out of pdfs.
- `exif-keys.json` specifies a list of attributes from exiftool that we would like to index
- replicate with the database of others to produce a collective database of file metadata - using either `hyperswarm` or `discovery-swarm` for peer discovery.
- private and public groups possible.

## Dependencies

- [Exiftool](https://www.sno.phy.queensu.ca/~phil/exiftool/) must be installed

## Additional modules

- [metadb-http-api](https://github.com/ameba23/metadb-http-api) - http interface
- [metadb-ui](https://github.com/ameba23/metadb-ui) beginnings of a web front end using [choo](https://choo.io/) - help welcome

## Command line usage

- `metadb connect [key]` - connect to a network and listen for peers. (leave this open in a separate terminal window)
- `metadb index <directory>` - index a directory
- `metadb name <name>` - give yourself a name
- `metadb query <queryobject>`  - run a query
- `rm -rf ~/.metadb` - delete the database and the view indexes

## API (not yet stable)

```js
const MetaDb = require('metadb')
metaDb = MetaDb(options)
```
options is an optional argument containing an object with options:
- `options.path` - a string containing the desired directory to store the database. Defaults to `~/.metadb`

### `metaDb.ready(callback)`

`callback` is called when the db is initialised. callback takes no arguments.

### `indexFiles(directory, callback)`

- `directory` is a string with a path to some media files to be indexed.

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

- exiftool started as a child process.  A native library would be better

## TODO

- handle query with no database
- run with 'forever' for swarming?
- yaml config file with shares
- assert validation
- serve a requested file, publish a private reply with the discovery key 
