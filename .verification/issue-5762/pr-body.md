## Summary

Preserve approval requests, cancellation requests, confirmed cancellation, and policy/user rejection as distinct tool observations. Qualify activity disclosure through live delivery, replay, raw transcript storage, ordinary logs, Client v1 reads, and HFR export.

## Why

Refs #5762. These states previously decoded as unknown or collapsed into an unspecified rejection. The issue also lacked a criterion-to-test map and explicit Client v1/export sentinel evidence.

## Changes

- Extend the additive display state model, validators, tracker request observations, labels, and first-terminal-wins fold. Requests never imply permission or confirmed effects.
- Add lifecycle serialization/replay/settlement fixtures and forged receipt markers, including a proposal-review permit, to the real send-route disclosure fixture.
- Check raw persisted JSON as well as projected history, authenticated Client v1 response bytes, and HFR JSONL.
- Map all twelve original criteria to tests and document the remaining producer decision under OpenCoven/coven#1137.

## Verification

- Focused lifecycle, reasoning, correlation, migration, disclosure, export, and actual route tests pass.
- Typecheck, full lint, test-registry validation (2,074 files), and diff checks pass.
- All 1,442 app files pass across the original run and registry continuations (465 + 786 + 191). Initial interruptions were scratch-home overrides conflicting with fixtures; continuations preserve the existing assertions and runner flags with isolated storage.
- All 517 API files pass across retry and continuation (347 + 170). The initial runs exposed fixture-home/socket-path assumptions under the isolation overrides; no assertions were changed.

## Risk + rollout notes

This is an additive display contract. Existing adapters do not gain unsupported approval/cancellation capabilities. Legacy rejection retains its unspecified cause; disconnect/turn stop still means unknown, never confirmed cancellation. Binding, approval and effect references remain unavailable pending Val’s producer-contract decision. The producer decision remains outstanding under #5762. Native/provider/UI qualification belongs to the downstream issues.

Coven-Harness: codex / gpt-6
