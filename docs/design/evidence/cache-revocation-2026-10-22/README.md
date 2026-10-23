# Cache revocation qualification — #5764

Local qualification for this bounded slice passed. Production Playwright and managed-access/expiry receipts now qualify the final durable-only 404 repair; the independent Chrome counter observation also passes on this build. Preceding-candidate evidence is retained separately. This is the bounded cache-revocation slice of #5764, not completion of the issue, epic #5761 or gate #5767. [The machine receipt](qualification-progress.json) identifies the production build and exact source hashes; qualification is bound to rebased code head `c94dd4bbe00631a489190519cdc1d7c3648220c1` and those source hashes. Earlier candidate receipts remain under `before-main-rebase/` and `preceding-candidate/`.

Access denial and project-policy changes invalidate already admitted conversation, encrypted-cache adapter and live-generation state. Stream aliases propagate invalidation, queued notifications and delayed frames cannot restore revoked content, and open lazy-output disclosures clear without redispatching a send. Confirmed deletion and a cached transcript's authoritative absence clear both display and ownership references. An uncached 404 also blocks and purges any durable-only copy, while a new unsaved stream remains live until its own authoritative outcome.

| Boundary | Current evidence | Limit |
| --- | --- | --- |
| Conversation cache and pending 200/304 | Failing-first invalidation tests; denied/deleted/expired reopen tests | Cache is not an authorization authority |
| Encrypted offline cache adapter | Pending read/write versus delete/clear tests; failed purge blocks reads within the window | IPC is controlled in tests; no keychain or packaged restart claim |
| Live owner and stable aliases | Registry/owner guards, alias propagation, ownership-ref tests | Abort does not establish a tool outcome |
| Open lazy output | Hook tests and production-browser 403 during a live send | Browser routes are controlled fixtures |
| Project access policy | Existing publisher invalidates all admitted chat data | Cache keys lack a verified project-membership map; broader delegated claims remain with #6072 |
| Export | Existing HFR projection tests pass; exporter reads local canonical files, not browser caches | No delegated CLI principal boundary is claimed |
| Recovery/golden-06 | Stream-buffer and replay-route tests pass | Real-client reconnect counter stayed at 1 through interruption/reload; negative control reached 2 |
| Managed access/golden-11 | Production device gateway closes the active stream and returns 403 for replay/history/detail after revocation; pending known IDs and allowed unknown IDs are rejected | Controlled external peer inventory; physical ingress and broader per-project delegation remain unqualified (#6072) |

Production Playwright passed 14 cases with retries disabled, including historical/lazy/live content clearing after a 403 and late-frame suppression with exactly one send. This is controlled-browser evidence. It does not establish real-provider behavior, native parity, a committed external effect or exactly-once execution.

First failures are retained in the preserved issue worktree under `.tmp/issue-5764-evidence/`: conversation epochs, denial fallback, durable read/write races, missing ownership refs, stable-alias invalidation and the lazy-output hook failed before repair. Source-contract assertions were updated to require the new invalidation behavior while retaining their original ordering and ownership checks. Restricted-import lint failures were repaired by injecting the access subscription from ChatView, without relaxing the history boundary.

The [real-client receipt](real-client-reconnect.json) and separate [Chrome observation](browser-recovery-observation.json) qualify interrupted recovery on the recorded build: one dispatched composer send, one provider request, a counter of 1 before interruption and after history reload, and a negative control of 2. The scratch server/daemon shut down and fixture storage was removed; the dedicated Chrome tab was intentionally left open. This qualifies observed non-redispatch in this controlled scenario, not an exactly-once guarantee.

The [managed-access and expiry receipt](managed-access-expiry.json) passed on the same production build: the finished buffer expired, authorized history survived a server restart, missing/invalid credentials remained denied, and the counter stayed at 1 with one provider request. Revocation closed the active device stream and denied its subsequent replay/history/output reads. This is HTTP gateway evidence with controlled peer identity, not physical ingress or broader delegated authorization.

The rebased full app and API gates passed: 1,477 app files and 538 API files, using the documented per-child scratch isolation and explicit temporary-HOME fixture list. Rebased full lint, standalone typecheck, test wiring (2,130 files) and production build passed. All first failures and environmental corrections remain recorded; no assertion, test sleep, automatic retry or gate was weakened.

[Verification commands and attempt history](verification.md) retain the environmental corrections, per-test isolation mechanism and first-failure log identities.

All runtime work uses scratch state. The approved worktree is intentionally preserved for #5764. No merge, release, canary, worktree deletion, real-user-data access or keychain operation is part of this qualification.
