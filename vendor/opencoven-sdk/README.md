# Pinned SDK consumer artifacts

These unmodified packages were built from OpenCoven/sdk commit
`d4cf105df882271497ab9eeacf075af87e8d6330` for Cave issue #5217. The selected
source is OpenCoven/sdk; its experimental packages are not published to npm.
Keeping the tarballs in Git makes clean builds independent of a local SDK
checkout, temporary directory, mutable branch or install-time build script.

`provenance.json` records archive SHA-256 and byte sizes. The dependency-policy
gate independently pins both hashes and the source revision. pnpm also records
archive integrity in its lockfile. The override ensures the Coven package's
core dependency resolves to the same reviewed archive. This is a two-package
exception to exact registry versions, not a general file-dependency exception.

To reproduce, check out the exact revision in an isolated SDK checkout, run
`pnpm install --frozen-lockfile`, then
`node scripts/pack-public-packages.mjs --json-file /tmp/sdk-package-map.json`.
Compare the core and coven tarball hashes with this manifest. Refreshes require
reviewing the source delta, rebuilding, updating both independent pins and the
lockfile, and running Cave's SDK integration and supply-chain checks. Do not
publish the SDK or replace these files from a mutable branch as part of install.

The archives retain the upstream README, changelog and license files, including
the AGPL-3.0-only OR MIT license choice. They expose package-root imports only.
Validated data does not establish authenticated authority or certify Automations.
