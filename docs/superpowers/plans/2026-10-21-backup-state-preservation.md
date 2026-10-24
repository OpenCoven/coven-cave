# Backup sync state preservation implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Checkboxes are not evidence of completion; consult code, merged PRs and the execution ledger.

**Goal:** Preserve rejected backup configuration and show the user how to recover instead of silently resetting it.

**Architecture:** Keep the existing backup engine and settings resource. Make its state reader default only for a missing file, reject malformed or unsupported state with actionable errors, and validate state before credential mutations. Carry server error text through the existing Settings resource and error component. No new scheduler, persistence layer, dependency or automatic migration.

**Tech Stack:** TypeScript, Node filesystem APIs, existing Next route handlers, React Settings resource, canonical tests and isolated production browser/API verification.

**Spec:** [Issue #6172](https://github.com/OpenCoven/coven-cave/issues/6172), under [#6119](https://github.com/OpenCoven/coven-cave/issues/6119).

## Global constraints

- Preserve rejected file bytes, credentials, snapshots and unrelated data. Do not repair or downgrade persisted state automatically.
- Keep a genuinely absent file's disabled defaults and supported version-1 configuration behavior.
- Keep archive encryption, retention, single-flight coordination, scheduler cadence, deadlines and destination policy.
- Use existing Settings error/focus/announcement primitives; no new modal or repair workflow.
- Faults use private synthetic profiles. Preserve every failed sample and owned source unit; no release or real-profile changes.

## Review focus

1. Missing files must still initialize, while permission/read errors cannot look like empty configuration.
2. Malformed JSON, nonobject roots and unsupported schema versions must preserve exact bytes and provide a useful next action.
3. Rejected state must stop config/status/manual backup paths and passphrase save/clear before side effects.
4. State becoming unreadable or unsupported before a status write must remain preserved; do not replay an archive whose outcome is ambiguous.
5. Initial and background Settings errors must display guidance, retain previously loaded values where appropriate, and clear after successful recovery without accepting stale responses.

### Task 1: Preserve and explain rejected backup state

**Files:** modify `src/lib/server/backup-sync.ts`, `src/lib/server/backup-sync.test.ts`, `src/app/api/backup/sync/route.ts`, `src/components/settings-general-data.tsx`, `src/components/settings-general-data.test.tsx`, `src/components/settings-shell.tsx`, and `tests/settings-general-data.spec.ts`. Retain this plan and add it to the existing docs index if required by its contract.

**Interfaces:** keep public backup config/status/overview and run signatures. The private state reader returns only supported state or throws an actionable error. The shared Settings resource adds a nullable `error` string alongside value/status/refresh/publish; successful reads and saves clear it. Route response envelopes and origin checks stay unchanged.

- [ ] Add failing real-filesystem regressions to the existing backup test: malformed JSON, null/array roots, invalid/future version, non-ENOENT read failure, config update and all three run reasons. Assert refusal, exact file bytes, no new/pruned archive and preserved unrelated marker. Preserve the existing missing/valid-state and decryptable-archive cases.
- [ ] Add actual route tests with an existing synthetic vault passphrase. For rejected state, GET/PUT and manual run must fail; save/clear passphrase requests must leave the credential unchanged, including a request with no config patch. Assert actionable response copy and byte preservation. Run the canonical selector and retain the expected failures.
- [ ] Make state loading return defaults only on ENOENT; validate JSON object, supported version and state containers before sanitizing supported fields. Use explicit recovery/update/access guidance without echoing raw malformed contents. Reject before config/status writes and before credential mutations in PUT. Preserve the existing single-flight runner and schedulers.
- [ ] Extend the Settings resource behavior test to retain a server-provided error on initial/background failure, clear it on successful refresh/publish, and ignore an aborted stale response. Run it RED before the change.
- [ ] Carry that message through the existing resource and display it in Scheduled sync's current error presentation. Keep the generic sidecar guidance as fallback when no usable server message exists. Preserve loaded values during a background error.
- [ ] Extend the existing Settings browser spec for an initial rejected backup state with visible repair guidance, then an explicit successful retry clearing the error. Add a background failure case retaining loaded settings and showing the actionable message. Run against the production candidate; preserve the old-build failure evidence.
- [ ] Run related canonical backup/archive/manifest/restore, Settings resource/contracts and API contracts; typecheck, scoped lint, test wiring and docs/design gates. Expected: all selected checks pass without changing budgets.
- [ ] Build production with existing budgets. Repeat the actual malformed/future-state API fault cases and verify rejection and exact preservation. Verify a missing-file setup and valid decryptable backup still work. Independently verify owned processes, ports, sockets and marker hashes.
- [ ] Commit/push explicit files with hooks. Obtain one fresh whole-branch review on the exact commit, make one tested substantive fix pass if needed, and require complete current-head checks/feedback before normal protected squash merge. Record retained unit disposition and platform/concurrency limitations.
