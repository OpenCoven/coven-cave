# Research core boundary

Decision for [#5993](https://github.com/OpenCoven/coven-cave/issues/5993): Research should become an optional application subsystem. Its desk, mission engine, ingestion, indexing, and media processing do not belong in the baseline shell startup path. This decision does not remove Research or migrate existing data in this change.

The Research UI already loads on demand through `researcher-surface-loader.tsx`. Moving that UI alone is therefore unlikely to materially reduce ordinary typing lag. The performance opportunity is its server startup and background work; the surface reduction requires extracting the implementation and its tests together.

Before extraction, separate shared contracts currently owned by Research:

- Keep generic run references, chat links, execution admission, approvals, and session authority in core. Flow execution and attention handling already consume these contracts.
- Move shared GitHub SHA validation and project-path helpers to neutral modules. GitHub review, merge, and diff routes must not depend on an optional Research package.
- Keep authentication and media access checks in core, with an explicit capability boundary for Research routes.
- Preserve backup/restore compatibility and interrupted-restore recovery for existing Research data, including when the feature is disabled. Do not silently drop archived data.
- Register ingestion, indexing, media workers, and mission recovery explicitly when Research is enabled; retain necessary privacy/expiry cleanup for existing data.

Follow-up acceptance: core launches with Research absent; ordinary chat, Flow, GitHub, security, and backup tests pass in that configuration; enabling Research restores existing missions/resources without migration loss; startup and idle work are measured before claiming a lag reduction. Removing the speculative surface warmup and blanket route preload is the immediate responsiveness change in #5993.
