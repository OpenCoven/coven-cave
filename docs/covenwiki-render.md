# Read generated wikis

Open `/wikis` to browse local CovenWiki manifests. A wiki opens at
`/wikis/<repo>`; its pages open at `/wikis/<repo>/<page>`. Both names use the
generator's lowercase, hyphen-separated slugs.

The default store is `<COVEN_HOME>/wikis` (`~/.coven/wikis` without an override).
To read a store created with the regeneration CLI's `--wikis-dir`, start Cave
with `COVENWIKI_WIKIS_DIR` set to that same directory.

The shell reads only `manifest.json`, validated against
[`covenwiki-manifest.schema.json`](covenwiki-manifest.schema.json). Selecting a
page loads its markdown and metadata through `/api/wikis/<repo>/page/<page>`.
The wiki index loads `index.md`, falling back to the manifest's page list when
it is absent. `/api/wikis` lists manifests and `/api/wikis/<repo>` reads one.
All three APIs are read-only and disable caching.

Draft output remains readable. Page priority, prose length, coverage notes,
related pages, and citations appear with the page. Citations open Cave's file
viewer; its existing project access checks still apply. Opening a wiki does
not grant access to its source repository.

Unknown or invalid wikis and page slugs return 404. Store reads reject traversal,
symlinks below the configured root, multiply-linked files, non-regular files,
and files over 4 MiB. Unknown manifest fields remain compatible with schema 1.0.

Generation, regeneration, and freshness scanning are outside this surface.
No wiki files are written by the reader.
