## `metadb-core`

[metadb](https://github.com/ameba23/metadb) is a peer-to-peer media file metadata database and file-sharing program. Peers can extract information about their media files and replicate this data with other peers, to build a searchable distributed database of all known files.

This module contains the core functionality - the handshake, distributed index, and file transfer.

## Complementary modules

- [metadb](https://github.com/ameba23/metadb) - The top-level module. Provides an HTTP API, and a limited command-line client 
- [metadb-ui](https://github.com/ameba23/metadb-ui) a web front end using [choo](https://choo.io/)
- [metadata-extract](https://github.com/ameba23/metadata-extract) - pulls metadata from media files

### Description of files in `./lib`

- `./lib`
- `├── config.js` - load and save yaml config
- `├── crypto.js` - crypto operations with sodium-native
- `├── file-transfer`
- `│   ├── index.js` - downloading / uploading files 
- `│   ├── messages.js` - created by the protobuf compiler
- `│   ├── request.js` - process requests for files
- `│   └── schema.proto` - protobuf message schemas for file transfer
- `├── handshake.js` - the handshake scheme
- `├── ignore.js` - for ignoring certain files when indexing
- `├── index-files.js` - for indexing local media files
- `├── messages.js` - created by the protobuf compiler
- `├── publish` 
- `│   ├── index.js` - for publishing messages to your feed
- `│   └── publish-invite.js` - WIP
- `├── queries`
- `│   ├── index.js` - queries for searching for files and peers
- `│   ├── own-files-from-hashes.js`
- `│   └── query-abouts.js`
- `├── schema.proto` - protobuf schemas for feed messages
- `├── swarm.js` - connect / disconnect from 'swarms'
- `├── util.js` - utility functions
- `└── views`
- `    ├── files.js` - files database view
- `    ├── invites.js` - invites database view (WIP)
- `    ├── peers.js` - peers database view
- `    └── wall-messages.js` - wall-messages database view (WIP)

### Key dependencies

- [`hyperswarm`](https://github.com/hyperswarm/hyperswarm) - distributed hash table for finding peers
- [`kappa-core`](https://github.com/kappa-db/kappa-core) - distributed database using [`multifeed`](https://github.com/kappa-db/multifeed) and [`hypercore`](https://github.com/hypercore-protocol/hypercore)
- [`metadata-extract`](https://github.com/ameba23/metadata-extract) - pull metadata from media files
- [`multiplex`](https://github.com/maxogden/multiplex) - make multiple binary streams from a single one
- [`pull-stream`](https://pull-stream.github.io/) - streams where data is pulled out rather than pushed in
- [`simple-message-channels`](https://github.com/mafintosh/simple-message-channels) used in the file transfer protocol, and [hypercore-protocol](https://github.com/hypercore-protocol/hypercore-protocol)
- [`sodium-native`](https://sodium-friends.github.io/docs/) - node bindings to libsodium crypto library
- [`tar-fs`](https://github.com/mafintosh/tar-fs) - stream files as a tar archive (used to transfer files)

## API (not yet stable, documentation very incomplete)

```js
const Metadb = require('metadb')
metadb = Metadb(options)
```
options is an optional argument containing an object with options:
- `options.storage` - a string containing the desired directory to store the database. Defaults to `~/.metadb`

### `metadb.ready(callback)`

`callback` is called when the db is initialised. callback takes no arguments.

### `indexFiles(directory, callback)`

Index a local directory. The directory will be scanned recursively and a message published for each media file, containing its metadata.
- `directory` is a string with a path to some media files to be indexed.

### `metadb.buildIndexes(callback)`

callback is called when the kappa-core indexes are built. callback takes no arguments. Queries cannot be run until this method has run.

### `metadb.publishAbout(name, callback)`

Publish an 'about' message with a name or other information to identify yourself on the network.
- `name` a string to identify yourself on the network (eg: 'alice')

## Configuration

- `~/.metadb/config.yml` can be used to manually set the download directory and other settings
- `~/.metadb/ignore` is a list of patterns to ignore when indexing files (like .gitignore)
