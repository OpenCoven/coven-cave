# Reliable Chat File Ingestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve bounded HTML, JavaScript, archive, and other file payloads through Cave chat sends, transcript reloads, and retries, then materialize them as private files inside the local harness's granted runtime root.

**Architecture:** Extend the existing validated data-URL channel beyond images and playable media. The composer retains bounded generic file bytes, the server validates the payload again, and local file-capable harnesses receive random runtime paths. Supported source files also receive a durable store id in metadata-only conversation records so regenerate/retry can rematerialize the exact bytes without embedding base64 in transcripts. Generic files served back through Cave are downloads, not executable inline content.

**Tech Stack:** TypeScript, React browser File APIs, Node.js filesystem APIs, Node test runner

---

### Task 1: Preserve bounded generic file payloads

**Files:**
- Modify: `src/components/chat-view.tsx`
- Test: `src/components/chat-view-first-class.test.ts`
- Modify: `src/lib/chat-attachments.ts`
- Test: `src/app/api/chat/send/chat-send-image-persistence.test.ts`

- [x] Add a failing test proving a ZIP data URL survives normalization and send-body stripping.
- [x] Confirm the pre-implementation assertion fails.
- [x] Add a bounded, non-backtracking generic data-URL validator and retain valid generic payloads in `normalizeChatAttachments` and `stripPreviewOnlyAttachmentFieldsKeepingImages`.
- [x] Capture a data URL for bounded text and generic files in `fileToAttachment`, while retaining the existing 64,000-character text preview.
- [x] Admit ZIP files through the native picker and canonicalize the browser's
  ambiguous `video/mp2t` MIME for `.ts` source files.

### Task 2: Materialize all local file payloads

**Files:**
- Modify: `src/app/api/chat/send/chat-send-attachments.ts`
- Modify: `src/app/api/chat/send/route.ts`
- Test: `src/app/api/chat/send/chat-send-image-persistence.test.ts`
- Test: `src/app/api/chat/send/harness-routing-attachments.test.ts`

- [x] Add a failing test proving a ZIP is written with private permissions beneath the granted runtime root.
- [x] Replace image-only staging with attachment staging that validates images and generic payloads and writes random UUID filenames with safe extensions.
- [x] Pass the resulting per-index paths into `buildPromptWithAttachments`.
- [x] Prefer a runtime path over truncated inline text for local harnesses, preserve inline text for remote harnesses, and emit an explicit unsupported note for non-text generic files on remote harnesses.
- [x] Keep bounded orphan sweeping and post-turn cleanup limited to files minted by this module.

### Task 3: Persist retry-critical source files

**Files:**
- Modify: `src/lib/server/chat-attachment-store.ts`
- Modify: `src/app/api/chat/attachment/route.ts`
- Modify: `src/app/api/chat/send/chat-send-attachments.ts`
- Modify: `src/lib/travel-offline-replay.ts`
- Test: `src/lib/server/chat-attachment-store.test.ts`
- Test: `src/app/api/chat/attachment/route.test.ts`
- Test: `src/app/api/chat/send/chat-send-image-persistence.test.ts`
- Test: `src/app/api/chat/send/offline-queue-replay.integration.test.ts`
- Test: `src/lib/travel-offline-replay.test.ts`

- [x] Add failing tests proving an HTML source round-trips through the durable store and a transcript reload can rematerialize it for retry.
- [x] Store allowlisted source/document extensions with private permissions and the 20 MB generic-file cap.
- [x] Reject MIME/extension spoofing before persistence.
- [x] Rematerialize metadata-only attachments from their durable `storedId`.
- [x] Force source/document responses to download while keeping images and playable media inline.
- [x] Fail offline hub replay visibly when the hub contract cannot transfer
  queued attachment bytes, rather than marking a lossy replay synced.

### Task 4: Verify focused behavior

**Files:**
- Modify: `handoffs/thread-signal-remediation-2026-08-20.md` in Cody's familiar workspace

- [x] Run the focused attachment persistence and harness-routing tests.
- [x] Run targeted ESLint on the changed TypeScript files.
- [x] Run `pnpm typecheck`.
- [x] Inspect `git diff --check`, the final diff, and worktree status; do not commit without Val's explicit approval.

Verification completed on 2026-08-20: 32/32 durable-store, serving-route, and
send/retry assertions passed along with the attachment library, picker,
harness-routing, offline-queue, travel-replay, and offline replay integration
probes. The self-report suite passed 36/36. Targeted ESLint, TypeScript
typecheck, and `git diff --check` exited 0. Changes remain uncommitted pending
Val's approval.
