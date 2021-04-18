## `metadb-core`

[harddrive-party](https://github.com/ameba23/harddrive-party) is a peer-to-peer media file metadata database and file-sharing program. Peers can extract information about their media files and replicate this data with other peers, to build a searchable distributed database of all known files.

This module contains the core functionality - the distributed index and file transfer.

## Related modules

- [`harddrive-party`](https://github.com/ameba23/harddrive-party) - The top-level module. Provides an HTTP API, and a limited command-line client 
- [`metadb-ui`](https://github.com/ameba23/metadb-ui) a web front end using [choo](https://choo.io/)
- [`metadata-extract`](https://github.com/ameba23/metadata-extract) - pulls metadata from media files

### Description of files in `./lib`

`./lib` \
`├── config.js` - load and save yaml config \
`├── crypto.js` - crypto operations with sodium-native \
`├── file-transfer` \
`│   ├── client.js` \
`│   ├── hash-pieces.js` \
`│   ├── messages.js` - created by the protobuf compiler \
`│   ├── peer.js` \
`│   ├── request.js` - process requests for files \
`│   ├── schema.proto` - protobuf message schemas for file transfer \
`│   └── server.js` \
`├── messages.js` - created by the protobuf compiler \
`├── scan-files` - for indexing local media files \
`│   ├── fs-walk.js` - recursive directory tree walk \
`│   ├── ignore.js` - for ignoring certain files when indexing \
`│   └── index.js`
`├── schema.proto` - protobuf schemas for feed messages \
`├── swarm.js` - connect / disconnect from 'swarms' \
`├── util.js` - utility functions \
`└── views` \
`.   ├── addFileMessage.js` process `addFile` messages \
`.   ├── fileCommentMessage.js` process `fileComment` messages \
`.   ├── files.js` - files database view \
`.   ├── index.js` - indexing with kappa-core \
`.   ├── peers.js` - peers database view \
`.   ├── rmFilesMessage.js` process `rmFiles` messages \
`.   └── wall-messages.js` - wall-messages database view

### Key dependencies

- [`hyperswarm`](https://github.com/hyperswarm/hyperswarm) - distributed hash table for finding peers
- [`kappa-core`](https://github.com/kappa-db/kappa-core) - distributed database using [`multifeed`](https://github.com/kappa-db/multifeed) and [`hypercore`](https://github.com/hypercore-protocol/hypercore)
- [`sodium-native`](https://sodium-friends.github.io/docs/) - node bindings to libsodium crypto library

## Configuration

- `~/.harddrive-party/config.yml` can be used to manually set the download directory and other settings
- `~/.harddrive-party/ignore` is a list of patterns to ignore when indexing files (like .gitignore)
