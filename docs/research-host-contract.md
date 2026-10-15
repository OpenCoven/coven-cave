# Research host contract

Research extraction is tracked in [#5997](https://github.com/OpenCoven/coven-cave/issues/5997).
The dedicated package consumes named adapters under `src/lib/research-host/`
through `@opencoven/research-host/*`. Each adapter exports an explicit set of
values and types from a core-owned module; wildcard exports are intentionally
excluded. These adapters preserve existing authorization, session ownership,
storage, and Flow behavior. They do not grant an alternative access path.

The package must use Cave's React and Next peer instances. Its independent CI
pins an immutable Cave revision containing these adapters. Changing an adapter
requires verifying the consuming package against the proposed host revision;
removing an export requires a coordinated package release and Cave pin update.
The optional runtime entrypoint and activation gates are delivered separately
as part of the same extraction issue.

Saved links belong to core. Chat uses `/api/links`, while the existing Research
endpoint delegates to the same handler and persisted store. Both endpoints
retain local-request authorization, validation, deduplication, X Article
handling, and GitHub enrichment. This prerequisite does not change ingestion
or worker activation. Shared schedule input types live in
`src/lib/research-automation-contract.ts`, without importing the mission runner.

This prerequisite supplies a reproducible host fixture; it does not complete
the extraction. Optional activation, removal of Research implementation from
Cave, and absent/disabled/enabled acceptance remain required before #5997 closes.
