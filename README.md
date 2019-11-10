## metadb

**WIP**

metadb is a peer-to-peer media file metadata database. Peers can extract information about their media files and replicate this data with other peers, to build a searchable distributed database of all known files.

There is also a system of sending encrypted requests for particular files, and responding to requests with a way of transferring them.

metadb aims to be transport agnostic - the focus of the project is on providing a metadata index - actual transfer of the files can be done by whichever protocol you choose: IPFS, DAT, Bittorrent, SCP, etc. This implementation contains a way to serve files as DAT archives, but any information can be included in a response to a request for a file, making it easy to plug in different transport mechanisms.

It also aims to be extendible - arbitrary data can be published about files, which might include comments, reviews, 'stars', or links to web resources such as wikipedia, discogs, imdb, etc.

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

Index a local directory. The directory will be scanned recursively and a message published for each media file, containing its metadata.
- `directory` is a string with a path to some media files to be indexed.

#### Example `addFile` message
```
{
  type: 'addFile',
  sha256: '843b5593e6e1f23daeefb66fa5e49ba7800f5a4b84c03c91fac7f18fb2a3663f',
  filename: 'donkey.jpg',
  size: 78394,
  metadata: {
    fileType: 'JPEG',
    fileTypeExtension: 'jpg',
    mimeType: 'image/jpeg',
    imageWidth: 200,
    imageHeight: 418 },
  },
  timestamp: 1573402125008
}
```

### `metaDb.buildIndexes(callback)`

callback is called when the indexes are built. callback takes no arguments. Queries cannot be run until this method has run.

### `metaDb.query(query, callback)`

Run a custom query
- `query` is an object

### `metaDb.publishAbout(name, callback)`

Publish an 'about' message with a name or other information to identify yourself on the network.
- `name` a string to identify yourself on the network (eg: 'alice')

#### Example about message
```
{
  type: 'about',
  name: 'Hedwig',
  version: '1.0.0',
  timestamp: 1573402125008
}
```


### `metaDb.publishRequest(files, recipients, callback)`

Publish an encrypted request message to up to 7 other peers. 
- `files` is an array of strings which should be the hashes of the requested files
- `recipients` is an array of 32 byte buffers which should be the public keys of peers to send the request to.

#### Example request message
```
{
  type: 'request',
  files: ['843b5593e6e1f23daeefb66fa5e49ba7800f5a4b84c03c91fac7f18fb2a3663f'],
  recipients: ['3c6c1fc2ac75cee8856df0c941cdcc0f0ae1337bcecaf6f89bd337ed1c2fecd7'],
  version: '1.0.0',
  timestamp: 1573402125008
}
```

### `metaDb.publishReply(key, recipient, branch, callback)`

Publish a reply containing a dat link for the requested files
- `key` should be a string containing some kind of link to the file - which might be dat, IPFS, bittorent magnet or some other kind of link.
- `recipient` should be 32 bytes buffer which should be the public key of a single recipient
- `branch` should be string containing a reference to the `request` message of the format `feed@seq`.

#### Example reply message
```
{
  type: 'reply',
  key: 'dat://fb17ae61d02cd97cb4a3f8b4ea6599afa152e361ff4aac6a27842effb2246126',
  branch: '3c6c1fc2ac75cee8856df0c941cdcc0f0ae1337bcecaf6f89bd337ed1c2fecd7@5',
  recipients: ['3c6c1fc2ac75cee8856df0c941cdcc0f0ae1337bcecaf6f89bd337ed1c2fecd7'],
  version: '1.0.0'
  timestamp:
}
```

### `metaDb.swarm(key)`

- listen for peers on `key`, and replicate if you find any

## Config file

`~/.metadb/config.yml` contains information we don't want to store on the feed for privacy reasons. Currently it only contains the absolute paths of the files which are indexed.

## Issues

- exiftool started as a child process.  A native library would be better

## TODO

- handle query with no database
- run with 'forever' for swarming?
- yaml config file with shares
- assert validation
- serve a requested file, publish a private reply with the discovery key 
