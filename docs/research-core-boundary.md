# Research core boundary

Decision for [#5993](https://github.com/OpenCoven/coven-cave/issues/5993): Research is an optional application subsystem. Its desk, mission engine, ingestion, indexing, and media processing are outside the baseline shell startup path. The extraction preserved existing data formats and made Research installation and activation explicit. It shipped in PR #6025 (merged 2026-10-15); [#5997](https://github.com/OpenCoven/coven-cave/issues/5997) is closed, and the [verification report](research-extraction-verification.md) records the evidence.

The Research UI already loads on demand through `researcher-surface-loader.tsx`. Moving that UI alone is therefore unlikely to materially reduce ordinary typing lag. The performance opportunity is its server startup and background work; the surface reduction requires extracting the implementation and its tests together.

The retained core contracts are:

- Keep generic run references, chat links, execution admission, approvals, and session authority in core. Flow execution and attention handling already consume these contracts.
- Move shared GitHub SHA validation and project-path helpers to neutral modules. GitHub review, merge, and diff routes must not depend on an optional Research package.
- Keep authentication and media access checks in core, with an explicit capability boundary for Research routes.
- Preserve backup/restore compatibility and interrupted-restore recovery for existing Research data, including when the feature is disabled. Do not silently drop archived data.
- Register ingestion, indexing, media workers, and mission recovery explicitly when Research is enabled; retain necessary privacy/expiry cleanup for existing data.

Acceptance requires: core launches with Research absent; ordinary chat, Flow, GitHub, security, and backup tests pass in that configuration; enabling Research restores existing missions/resources without migration loss; startup and idle work are measured before claiming a lag reduction. Removing the speculative surface warmup and blanket route preload is the immediate responsiveness change in #5993.


## Persistence retained by the optional package boundary

The extraction in #5997 keeps the lexical and semantic SQLite storage modules
in core. They own persisted formats, authority validation, safe file replacement,
restore coordination, deletion, and compaction. Interrupted restore rebuilds the
lexical database from verified snapshots; deletion must purge semantic rows and
residual files even when Research is absent. Recovery closes the maintenance
and rebuilt-index handles, including their restore-marker timers, before return.

Research owns ingestion, the embedding HTTP provider, semantic job execution,
resource retrieval orchestration, mission execution, and media workers. None is
needed to open or repair an archive. `research-maintenance-boundary.test.ts`
checks the actual backup bundle dependency graph excludes those implementations.
The package consumes explicit storage adapters; it does not duplicate or change
the on-disk formats. Moving the storage backend itself would make offline
recovery depend on the optional package and is outside this boundary.

The package dispatch gate runs before loading implementation. It preserves the
existing scoped native-media ticket and validated run-stream GET credentials;
other endpoints retain the ordinary local-request guard. Handler-level HTTP
contracts live with Research, while Cave checks route inventory, exact dispatch,
authorization before loading, and absent/disabled responses.
