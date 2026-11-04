# Canonical inbox preservation implementation plan

> **For agentic workers:** Use superpowers:executing-plans for inline implementation and one independent final review. The steps below describe implementation intent, not a live task checklist; GitHub #6153 owns execution status.

**Goal:** Refuse inbox operations that would replace unreadable, malformed or incompatible authoritative data, preserve the original bytes, and expose useful recovery guidance.

**Architecture:** Validate the existing store at its read boundary; only ENOENT creates an empty inbox. Keep migration exclusion and atomic persistence. Recognized storage failures become structured responses on the main inbox API; failed stream initialization releases its subscription. Reuse existing interfaces instead of introducing a storage framework.

**Tech Stack:** TypeScript, Node filesystem/test runner, existing Next route handlers.

**Spec:** [#6153](https://github.com/OpenCoven/coven-cave/issues/6153), within [#6119](https://github.com/OpenCoven/coven-cave/issues/6119).

## Global constraints

- Isolated synthetic HOME, COVEN_HOME and COVEN_CAVE_HOME only. Never fault-inject real data.
- Keep existing locks, supported reminder behavior, item extensions and atomic writes; no automatic repair, deletion or retry.
- Preserve otherwise valid legacy inboxes that omit the version. Reject unsupported newer versions and invalid envelopes instead of normalizing data away.
- No change to the room UI, schema migration, authorization or provider admission. This delivery protects storage and main API error reporting; it does not complete every client recovery surface.
- All selected exact-head checks and one independent review precede protected merge. Retain the worktree and evidence.

## Review focus

- An error after successful startup must not be hidden by the cached migration result.
- Permission/non-file read failures are distinct from absence and must never permit a replacement write.
- Older valid records and unknown item fields must survive an ordinary update; schema checks must not invent a new format.
- A stream whose initial snapshot fails must release the already-admitted subscriber and must not create a heartbeat afterward.
- Main API failures must preserve authorization, omit arbitrary stored text and avoid broadcasting a mutation that did not commit; unrelated exceptions must not be mislabeled as storage failure.

### Task 1: Fail closed at the store and preserve the error through its callers

**Files:**
- Modify `src/lib/cave-inbox.ts` (store reader and narrow storage error).
- Modify `src/app/api/inbox/route.ts` (GET/POST storage-error responses).
- Modify `src/app/api/inbox/stream/route.ts` (failed-initialization cleanup).
- Create `src/lib/cave-inbox-preservation.test.ts` and `src/app/api/inbox/storage.test.ts`.
- Modify `scripts/run-tests.mjs` to wire both tests; include this plan.

**Interfaces:** Existing loadInbox/createItem/updateItem/applyBulkAction and withInboxLock signatures stay stable. Add exported InboxStorageError with codes `inbox_invalid`, `inbox_incompatible`, and `inbox_unavailable`; the main API returns 503 JSON only for this class. Invalid-data guidance: "Inbox data is invalid. Restore a valid inbox.json backup before changing reminders." Newer-version guidance: "Inbox data was written by a newer version of Cave. Update Cave before changing reminders." I/O guidance: "Inbox data could not be read. Check access to inbox.json, then try again." Do not require callers to know raw JSON parse errors. I/O errors remain failures; choose fixed unreadable-storage guidance with the original cause retained internally when mapping them.

1. Write behavioral regressions against real filesystem fixtures. Warm the store once, replace its canonical bytes with malformed JSON, and require both reads and later mutations to reject while preserving exact bytes. Add literal invalid-root/items/record/version cases, non-file I/O, missing-file creation, legacy omitted-version compatibility, unknown item-field preservation, and successful operation after an explicit fixture restore.
2. Add actual GET/POST cases asserting 503, privacy-safe guidance, no file change and no mutation broadcast; include denied POST authority before storage. Exercise real SSE initialization failure and verify its subscriber is released, with owned test timers cleaned up.
3. Run `node --experimental-strip-types --import ./scripts/test-alias-register.mjs --test src/lib/cave-inbox-preservation.test.ts src/app/api/inbox/storage.test.ts` in an allowlisted isolated environment before implementation. Expected: preservation and actionable-response cases fail because current code returns an empty store/200 or overwrites the file. Retain this RED output. A harness/import failure is not product evidence.
4. Implement the smallest reader validation and error mapping. Only ENOENT defaults to an empty inbox. Validate an object root, schema version 1 (omission retains the legacy fallback; other invalid values fail), an items array and object records with stable string IDs, without dropping records or unknown fields. Full semantic validation of every historical item field is not introduced. Keep supported unknown item data unchanged. Map only InboxStorageError in the main GET/POST route; do not catch/retry arbitrary mutation errors. Release the stream subscriber on snapshot rejection before rethrowing the original error.
5. Run the new tests plus `src/lib/cave-inbox-create.test.ts`, `src/lib/cave-inbox-bulk.test.ts`, `src/lib/familiar-reminder-scope.test.ts`, `src/app/api/api-contracts.test.ts`, `src/lib/server/api-security.test.ts`, `src/lib/server/local-origin.test.ts`, `src/lib/server/cave-home-migration-status.test.ts`, and `src/lib/server/cave-home-migration-status-recovery.test.ts` with the same Node runner and isolated paths. Expected: all pass. Run `pnpm typecheck`, scoped `pnpm exec eslint` on changed TypeScript files, `pnpm check:tests-wired`, `pnpm check:test-clocks`, `node --test scripts/plan-doc-checkbox-hygiene.test.mjs`, and `git diff --check`. Confirm the installed package script name for the clock check before invoking it. Broaden only for concrete failures or uncovered affected consumers.
6. Check the complete scoped diff, commit/push, then obtain one fresh independent exact-diff review. Fix substantive findings with failing-first evidence in one pass; record deferred minors and review limitations. Require current-head hosted checks and protected delivery; record retention/rollback on the issue.

Rollback is a normal revert of this scoped change; no data conversion or destructive action is introduced. Existing malformed bytes remain available for user-directed recovery.
