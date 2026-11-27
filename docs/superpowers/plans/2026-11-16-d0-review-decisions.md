# D0 review decisions implementation plan

**Goal:** Finish #6403's existing candidate using Val's delegated product decisions while preserving every original acceptance gate.

**Design:** Composer first; Overview focuses on attention, reported work and freshness. Keep Continue as the default recent-session list and put settled observations behind disclosure. Unknown execution remains visible. Keep the reload warning for in-memory staged files, a static Activity icon for everyone, and public source digests only. These are Codex's recommendations accepted through Val's three replies, not independent visual or human accessibility sign-off.

**Architecture:** Continue #6438's existing branch over current main, consuming its canonical producers, privacy projections and navigation repairs. Preserve both locked source worktrees. No new ledger, fetcher, authority state or token system.

**Acceptance authority:** The full original #6403 body and checkpoint 6756876607 remain authoritative. Live producer, Tauri/device, human VoiceOver and visual acceptance remain distinct from fixtures and cannot be closed by this plan.

## Tasks

- [x] Integrate current main without losing the original candidate or contributor provenance; retain source digests and Back repair #6444.
- [x] Extend the existing Home browser test to require an initially reachable composer, visible unknown state and disclosed settled history; run it before changing presentation.
- [x] Move Overview below the composer and narrow its default history; preserve focus when rows move, exact references, denied/stale states, drafts and staged bytes. Run affected Home/Continue/inline and privacy checks, then static and full suites.
- [x] Inspect rendered narrow/wide theme and reduced-motion/transparency captures; record source hashes, first failures, retries, skips and evidence limits.
- [ ] Review the final candidate, update the delivery/acceptance packet, and use protected delivery only if every applicable gate and owner disposition permits it. Keep unmet original acceptance open.

## Review focus

- A running row settling while focused must retain its focus and expand the destination disclosure.
- Unknown outcomes and stale/denied reads must not produce a healthy empty state.
- New first-use and workspace selection behavior on current main must coexist with Home fixtures and exact draft identity.
- Reload acceptance still loses in-memory staged bytes; the warning is protection, not durable file persistence.
- Current-main producer/privacy repairs must survive integration; historical D0 fixture greens cannot qualify the new candidate.

## Execution record

Current remote main: `ea2f41fbcf618cc80a1b6ab6ce03b912a347ea26`. Original PR head: `94c90e7f34873fb8e2ba4825028024bdfef9d491`. Conflict-free merge tree: `a5bc2c67610329798d3300203ee3ac010f46b495`. The same clean branch was locked for this continuation; no process had its working directory there. Original Claude session attribution and both locked source units remain preserved. The integration and product choices were committed and pushed as `5137337489fc1bf306aa899d9bac1937b7b2f426`; its hosted CI passed.

Final review: the collapsed-summary finding was reproduced red and fixed before the final 55-case browser pass. Both full app runs pass 1,528 files with the two original native-supervisor skips; API passes 625 files; the final same-build retained/mode run passes 37 cases. Five real-daemon HTTP scenarios pass separately from the failed interactive probes. No remaining original acceptance gate is inferred satisfied from these results.

Packaging follow-up: a matched main baseline isolated 19 excess generated Next files. Directly importing HomeOverview restores the unchanged native runtime budget to 9,041 files. Build `EFY6M3a7gR-UKv-NDFKO3` passes 55 Home/Activity, 37 retained/mode and 1,528 app files, with the same two native-supervisor skips. Read-only review found no actionable issue in the import change. The release-profile package remains unaccepted because native captures show a blank center; the scratch attempt was aborted with zero provider calls and verified teardown.
