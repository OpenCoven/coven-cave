# Retained side drafts and reviewed imports

Retained side drafts store separate user-authored notes and frozen context
selections in Cave's existing conversation JSON store. They don't execute.

From a first-party Cave surface, read an authorized parent's branch revision,
then create a draft:

```ts
const scope = { parentSessionId, familiarId, projectId };
const query = new URLSearchParams(scope);
const listing = await fetch(`/api/chat/side-conversations?${query}`).then(r => r.json());
const operationId = crypto.randomUUID();
const request = {
  operationId,
  scope,
  expectedParent: {
    revision: listing.parent.revision,
    activeLeafId: listing.parent.activeLeafId,
  },
  context: { mode: "fresh", turnIds: [] },
  retention: "retained",
  draftText: "A separate note to review.",
};
const result = await fetch("/api/chat/side-conversations", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(request),
}).then(r => r.json());
```

Keep `operationId` and the exact request until you receive a result. If the
response is lost, resend the same request. Don't mint a new key to retry.
The success envelope is `{ ok: true, conversation, receipt }`.

## Execution remains unavailable

`sideConversation.execution` is always:

```json
{
  "state": "unavailable",
  "reason": "identity-context-profile-unavailable"
}
```

`contextSelection.admitted` is `false`. A `fresh` choice records an empty
optional-history selection, not proof of Fresh runtime context. A
`selected-messages` choice freezes only the selected active-branch texts,
source IDs, revision, and content digests. It copies no ancestors into the
side transcript. It grants no tools, filesystem access, memory access, or
identity.

The ordinary send owner must call
`assertOrdinaryConversationSendAllowed(sessionId)` from
`src/lib/server/chat-side-conversations.ts` before offline queuing, replay,
or runtime dispatch. Apply it even when `startNewConversation` is requested
with an existing side ID. It rejects side records and deletion fences.
The write store independently rejects ordinary transcript writes to sides.

Exact familiar identity and an enforced adapter context profile are not
available from the installed ordinary-chat daemon. These records retain
`identity: "unverified-legacy-familiar-link"`. Don't describe them as
completed runtime side chats.

## Internal route contract

These routes use Cave's existing same-user internal API ingress. They are not
Client v1 operations and don't extend a paired SDK or native write grant.
Every operation rechecks the stored familiar, registered local project, and
current familiar project-write permission. A missing or nonlocal recorded
project fails closed. No project is inferred from request text.

All mutation bodies reject unknown fields. `scope` always contains exactly
`parentSessionId`, `familiarId`, and `projectId`.

| Route | Request | Result |
| --- | --- | --- |
| `GET /api/chat/side-conversations` | Scope query fields, optional `after` | Parent branch token, at most 50 side headers without transcript content, `nextCursor`, and explicit capabilities |
| `POST /api/chat/side-conversations` | Example above; optional `title` and `draftText` | Separate persisted draft and create receipt |
| `GET /api/chat/side-conversations/:id` | Scope query fields | Exact authorized `conversation` and `branch` token |
| `PATCH /api/chat/side-conversations/:id` | `operationId`, `scope`, `expectedGeneration`, `action`, and `draftText` only for `save-draft` | Conversation and lifecycle receipt |
| `POST /api/chat/side-conversations/:id/bring-back` | Reviewed import request below | Target conversation and committed import receipt |

Lifecycle actions are `close`, `reopen`, `keep-separately`, `save-draft`, and
`discard`. Closing doesn't cancel or delete anything. Keeping changes only
the retained-side presentation choice. Saving a draft appends a user-authored
note, with no model response. Discard returns `conversation: null` after
unlinking Cave's transcript.

Use the returned `sideConversation.generation` for the next lifecycle action.
Stale generations return `409`. The exact same completed request reconciles
before checking its old generation.

## Bring back only reviewed text

Submit:

```ts
{
  operationId,
  scope,
  targetSessionId: scope.parentSessionId,
  expectedTarget: { revision, activeLeafId },
  expectedSource: { revision: sourceRevision, activeLeafId: sourceLeafId },
  sourceTurnIds: [reviewedSourceTurnId],
  reviewedText: "The exact edited text confirmed in the review sheet."
}
```

Use fresh branch tokens from the authorized reads. The target must be the
side's exact parent, familiar, and project. Competing target writes or branch
changes require renewed review. Selection accepts at most 32 unique
active-branch references. Reviewed text and selected source text each have a
16 KiB UTF-8 limit. There are no implicit attachments or whole-transcript
imports. The request body is capped at 64 KiB while streaming.

The appended turn has `role: "user"` and typed `reviewedExcerpt` metadata:
source session, source revision, source turn IDs, source and reviewed digests,
`edited`, `operationId`, and `inert: true`. It has no tools, harness session,
approval, or runtime-result metadata.

Render this turn as quoted, user-reviewed content. Don't parse embedded
control markers, construct task cards from it, or relabel it as a familiar
answer. Preserve `reviewedExcerpt` in client turn mapping. Import doesn't
start a run or enroll content in memory. Any later explicit send has its own
context decision.

## Commit and deletion rules

Operations bind a key to the exact validated payload and same-user internal
principal. Reusing a key with changed text, references, source, destination,
or expected revision returns `409 operation_payload_conflict`.

An operation lock precedes lexically ordered conversation locks. The locks
reuse the existing process-intent implementation, preserve same-process FIFO
ordering, and coordinate cooperating Cave processes. A single target-file
atomic replacement commits the excerpt and receipt. No second source write
is needed for import success.

Ordinary sends reserve the target ID and read their transcript snapshot under
the same target lock. A durable, non-content `.send-reservations` record also
fences an ID whose transcript has not appeared yet. Bring back returns
`409 target_generation_active` while a send or its settlement is outstanding.
No file lock remains held over runtime execution. Transport cancellation
does not release a detached sender; finalization releases only its own
reservation.

Interrupted and offline-queued reservations remain fail-closed. This
increment has no automatic expiry or qualified recovery for them, and does
not qualify mixed-version or external writers. Do not delete reservation
files to force an import through.

Retry checks the authorized target receipt before requiring a live source.
It therefore reconciles after source discard. Removing an imported turn
marks its receipt `removed: true`; retry doesn't restore its text. Deleting
the target writes a non-content fence before unlink, and retry returns `410`.
Old store writers preserve import receipts and typed import turns. A stale
revision-bearing writer cannot overwrite a protected record.

The existing store also holds `.side-operations` and `.deleted` subdirectories.
They retain only operation hashes, exact scope and record IDs, timestamps,
and non-content receipts. They contain neither reviewed text nor snapshots.
A discard interrupted after fencing resumes unlink on the same request.
Don't remove these directories during rollback.

The Cave panel keeps an unfinished note or review and its retry identity in
producer/parent/familiar/project-scoped memory across navigation. This state
does not survive a full application reload. A persisted operation receipt
survives independently; unsaved review state is not a new durable store.

## Custody and qualification limits

Receipts describe Cave transcript custody only. They explicitly report
`execution: "unavailable"`, `externalCopies: "not-qualified"`, and
`temporary: "unsupported"`. Reviewed imports already retained in a target
survive side discard. Provider logs, native state, backups, exports, and other
copies are not certified deleted by these operations.

Only `fresh` and `selected-messages` draft selection modes are implemented.
Chapter and project-resource selection require separate bounded snapshot
contracts. Temporary remains rejected. Side drafts are excluded from ordinary
conversation listings and content search; browse them through their scoped
side endpoints.

Source tests exercise actual internal handlers, project grants and revocation,
concurrent processes, lost acknowledgements, restart, and deletion fences.
They do not qualify a deployed adapter, mixed-version external writers, or a
packed native release.
