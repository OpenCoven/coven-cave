# Scoped Claude Writes Implementation Plan

Delivery authorization, 2026-11-01: the maintainer subsequently authorized committing, publishing, protected merging and bounded pruning of the two task units. Earlier local-only statements below describe the verification snapshot before that authorization. Current delivery and cleanup receipts are tracked on Cave #6356 and Coven #1646; runtime release, deployment and real familiar acceptance remain separate.

> Execute inline with the executing-plans skill. The user approved the separate scoped-write design; no commits or publication are authorized.

Goal: resolve Cave #6356 through the Rust-owned authority contract, preserving existing Full and #713 behavior.

Architecture: new explicit `writeScope` policy, shared by the local CLI and daemon API, becomes a distinct LaunchPolicy variant. Native launch uses acceptEdits plus explicit protected-path rules, canonical writable roots and checked Claude profile. Cave supplies its live grant-store authority and refuses unsupported scoped-write profiles. The CLI's existing run path is a direct Rust runner, not a daemon API launch; both must use the same validator rather than claiming the CLI already delegates execution to the daemon.

Spec: docs/plans/2026-11-01-6356-scoped-write-proposal.md. Upstream companion: OpenCoven/coven#1646 in .worktrees/issue-1646-claude-scoped-write.

Constraints: no global bypass, no change to existing Full or Codex-only launchPolicy, no prompt-only enforcement, no user settings edits, no uncertain-owner takeover, no commit/push/merge/release/deletion. Unsupported layouts or runtime profiles fail closed with actionable copy. All evidence retains exact sources, first failures and synthetic-inference limitations.

## Task 1: Bind Cave authority changes

Files: src/lib/chat-runtime-scope.ts and its existing test; src/app/api/chat/send/route.ts.

- [x] Observe failing read-only grant forwarding regression, then filter writable project roots using the explicit projectRootAccess map.
- [x] Observe failing permission-mode and protected-resource fingerprint regressions, then bind both in fingerprint version 2; preserve #6216 spelling semantics.
- [x] Thread live access levels, mode and resources from the real route; run scope/routing tests, typecheck and focused ESLint.

## Task 2: Add the separate Rust contract

Files in Coven: crates/coven-cli/src/claude_write_scope.rs (new), main.rs, harness.rs, api.rs, daemon.rs, api_health.rs, and tests/smoke.rs.

Interfaces: `ClaudeWriteScope` JSON fields `version`, `primaryRoot`, `writableRoots`, `readOnlyRoots`, `protectedRoots`, all explicit; `validate_for_cwd(&Path) -> Result<Self>` canonicalizes real directories and checks overlap semantics; `native_args() -> Result<Vec<String>>` constructs native permissions. `LaunchPolicy::ClaudeScopedWrite(ClaudeWriteScope)` is separate from the existing Codex policy. CLI `--write-scope FILE` and API `writeScope` are explicit capability surfaces.

- [x] Observe the new CLI capability test failing on baseline.
- [x] Add strict-schema, unknown-profile, non-Claude, conflict, canonical-alias, protected-root and overlap tests. Behavior-first red receipts are retained for capability, grant/fingerprint, hardlink, normalized profile, actual inherited-environment/backslash escapes, and pre-init diagnostics; do not claim every unit assertion was independently observed red. Accept the writable child of a read-only parent when no broader write grant covers that parent; refuse ambiguous layouts instead of granting extra authority.
- [x] Implement the shared policy and native builder, preserving the existing Codex constructor and old public validation. Validate selected harness, mode, cwd and native profile at the actual launch boundary. Keep old permission/add-dir flags incompatible with the new self-contained scope.
- [x] Guard API writeScope with the same trusted-local authority checks as the existing launchPolicy. Do not silently ignore the field on any create/resume path. Advertise support independently.
- [x] Run focused Rust tests including original launchPolicy tests and contributor-safe smoke tests. Retain a local source binary for real-tool qualification.

## Task 3: Connect Cave and report refusals

Files: chat-send-capabilities.ts, harness-adapters.ts and tests; new focused scope-file helper and tests; chat/send/route.ts and route integration tests; skill-scan helper/tests if nested protected resources were omitted by its display-only covered-root optimization.

- [x] Add failing-first capability and scope derivation tests; create a private per-turn scope file from the canonical live grant inputs. Include resources even beneath a writable root. Do not promote read grants or absent levels.
- [x] In local full-mode Claude launches require --write-scope support, pass the scope instead of separate permission/add-dir flags, and retain read-only behavior for read mode. Refuse unsupported older runtimes with a specific code and update guidance.
- [x] Parse native permission_denials into a bounded actionable notice; preserve truthful result status and avoid claiming an artifact was produced.
- [x] Use actual route integration tests to exercise new/resumed/mode-changed/revoked/unsupported rows; do not rely only on source regex tests.

## Task 4: Real-tool acceptance and reviewable handoff

- [x] Reuse the isolated loopback model fixture to drive the actual Cave-to-Coven-to-Claude tool execution path. Verify file contents/absence for primary/additional writes, writable child/read-only parent, aliases, read-only/ungranted/protected paths, shell-mediated writes, new/resumed sessions and authority changes. Provider-backed Lucian acceptance stays distinct.
- [x] Finish final current-source Cave and Coven gates; capture exact base/diff hashes, tool versions, matrix results, first failures/retries/skips and all unsupported rows. Review the scoped diff and requirement coverage.
- [x] Finalize local-only reviewable changes and evidence; preserve worktrees with owner/reason, maintain canonical issue next steps, and leave protected delivery/release untouched.

Review focus: alias retargeting, conflicting nested grants, protected resources inside writable roots, environment/user-settings widening, and resumed sessions retaining old native authority. Each must be exercised in Tasks 2-4; an argv assertion or exit zero alone cannot satisfy these rows.

## Execution ledger

Task 1: live grant filtering and version-2 mode/resource fingerprint are implemented with observed assertion reds and passing focused tests. Registered-spelling semantics remain intact.

Task 2: separate Rust CLI/API contract, owner-local health capability, both shared builders, Read/Edit rules, filesystem-object admission, exact normalized profile and kernel guard are implemented. Focused scoped-write/API tests pass 9/9; original Codex launch-policy and Full regressions remain passing. Existing native environment authority sources are refused with a safe actionable explanation; normal credential/provider variables remain available.

Task 3: actual Cave route forwards a private lazy-created scope, refuses missing capability before execution, distinguishes missing runtime availability, replaces native state on grant/mode/resource changes, preserves denial/error status and saved notices, retires owned files, and safely classifies pre-init stderr refusals. The extended actual-route fake-runtime regression passes, including fragmented stderr, reload persistence and read-only primary refusal.

Task 4: the immutable reviewed binary and installed Claude pass 22 independently verified real-tool/result rows, including real daemon IPC, corrected protected skill roots, Read preservation, same-spelling alias retarget, revoked access, hostile user/project settings, native override refusal, unsupported version, nested conflict and literal-backslash refusal. Final broad gates pass (app 1507 files, API 557 files, Rust 5518 tests; documented existing skips); the evidence report retains failures, retries, scope limits and worktree disposition.

Final review: one fresh-context read-only reviewer inspected both working diffs. No commits were authorized, so the review-package script's nonempty-commit-range requirement could not apply; the supplied package contains the complete tracked working diff plus every new source/plan file. The reviewer reported four Important finding groups, no separate Critical or deferred Minor findings. No re-review was requested.

Final: fixed inherited native environment widening with a shared launch-boundary refusal policy. The real pre-fix receipt created denied files; separate final relaunch/background/managed override probes make zero model requests and leave all denied files absent. Hostile settings and legacy bypass probes retain intended positive writes while denying negative paths.

Final: fixed literal-backslash protected-path rewrite bypass by rejecting unsupported native rule syntax. The pre-fix actual Write created the protected file; the reviewed candidate refuses before model execution. Unit tests cover writable, read-only and protected root fields.

Final: fixed lost pre-init scope notices. The fragmented-stderr actual-route test failed with runtime_process_failed, then passed with a bounded safe runtime_write_scope_unavailable notice and no private sentinel reflection. The actual nested-conflict native run also refuses before model execution with that code.

Final: fixed acceptance coverage by preserving and correcting the mislabeled skill fixture, then independently checking final current-source file contents/absence and native tool results. Same-spelling retarget denies the old target and grants the newly canonical target during native resume; no obsolete authority was observed.

Ruling: native permissions remain a qualified edit boundary, with unsupported object layouts refused and new hardlinks guarded; this is not general shell or external-actor containment. Cost if overstated: untested write paths or races could exceed the claimed evidence.

Ruling: preserve #6216 spelling semantics because the actual retarget run demonstrates native authority replacement without stale writes. Cost if the runtime changes: the profile must be requalified before upgrade admission.

Ruling: reject inherited native authority sources rather than silently removing possible administrator restrictions. Cost: users with those overrides must restart with a supported runtime environment before scoped writes can run.

Final: Ruling: general shell confinement is outside the approved mechanism; only named tools/simple redirection are qualified. Cost if wrong: untested commands could exceed the claimed boundary.

Final: Ruling: concurrent external filesystem actors are outside this child-runtime boundary. Cost if ignored: they could race admission; do not claim their containment.

Final: Ruling: malicious owner-local executable substitution/version spoofing remains outside the trusted executable-selection boundary. Cost if ignored: a replacement executable could lie about enforcement.

Final: Ruling: other operating systems/versions remain refused until qualified. Cost: reduced availability until separate evidence exists.

Final: Ruling: provider-backed Lucian behavior and real billing remain unverified. Cost if conflated: synthetic evidence would be mistaken for production acceptance.

Final: Ruling: merge/publication/release/deployment remain outside authority. Cost: changes remain local until separately authorized delivery.
