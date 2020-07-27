## metadb-core

[metadb](https://github.com/ameba23/metadb) is a peer-to-peer media file metadata database and file-sharing program. Peers can extract information about their media files and replicate this data with other peers, to build a searchable distributed database of all known files.

This module contains the core functionality - the handshake, distributed index, and file transfer.

## Complementary modules

- [metadb](https://github.com/ameba23/metadb) - The top-level module. Provides an HTTP API, and a limited command-line client 
- [metadb-http-api](https://github.com/ameba23/metadb-http-api) - http interface
- [metadb-ui](https://github.com/ameba23/metadb-ui) a web front end using [choo](https://choo.io/)
- [metadata-extract](https://github.com/ameba23/metadata-extract) - pulls metadata from media files

## API (not yet stable, documentation very incomplete)

```js
const Metadb = require('metadb')
metaDb = Metadb(options)
```
options is an optional argument containing an object with options:
- `options.storage` - a string containing the desired directory to store the database. Defaults to `~/.metadb`

### `metadb.ready(callback)`

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

### `metadb.buildIndexes(callback)`

callback is called when the kappa-core indexes are built. callback takes no arguments. Queries cannot be run until this method has run.

### `metadb.publishAbout(name, callback)`

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

## Configuration

- `~/.metadb/config.yml` can be used to manually set the download directory and other settings
- `~/.metadb/ignore` is a list of patterns to ignore when indexing files (like .gitignore)
