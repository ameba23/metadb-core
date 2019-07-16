## metadb
based on an older project, [meta-database](https://github.com/ameba23/meta-database)
- `index-kappacore.js [directory]` extracts exif metadata from all files in [directory] and adds them to a hypercore, using kappacore, to allow more to join...
- `query-mfr.js` replicate with other instances, and build a key value store of all files, indexed by sha-256 hash

could be used to build a distributed db of media file metadata. 
