# Familiar continuity

Familiar continuity lets you navigate an existing conversation without
changing its transcript, runtime session, or permissions.

The navigation increment is **exact-conversation navigation**. It does not combine
every conversation with the same familiar label into one authorized thread.
Separate internal controls now create retained side drafts and append reviewed
excerpts. Those drafts are notes, not executing familiar conversations. They
do not admit selected context or qualify Temporary.

## Retain separate notes and review what returns

Enable familiar continuity in Cave, open an exact chat with a registered local
project, then choose **Retained side drafts**. You can start without parent
history or freeze selected parent messages as provenance. Neither choice
changes runtime context: no familiar runs inside these drafts.

Save notes, close and reopen the draft, keep it separately, or explicitly
discard its Cave transcript. Closing the panel preserves an unsaved note.
Lifecycle controls that would abandon it stay disabled until you save or
clear that text. Side records stay outside ordinary Recent/search retrieval
and cannot be sent through ordinary or generation chat endpoints.

For **Bring back**, select saved notes, edit the excerpt, and confirm the exact
text and destination. The target receives a literal user-reviewed quote, not
a familiar answer, instruction, approval, or memory write. Retry after a lost
acknowledgement reuses the exact operation and payload. A historical receipt
for an excerpt subsequently deleted does not restore it.

The desktop and iOS source preserve import provenance and suppress markdown,
protocol controls, and link previews for reviewed excerpts. Failed-resume
history replay labels these excerpts as quoted data, not ordinary user
instructions. Importing does not inject context into an already-running
native session.

The [retained-draft API contract](retained-side-drafts-api.md) defines bounded
inputs, scoped mutations, ordered locks, conflict responses, and durable
receipts. It is an internal same-user API, not permission for the frozen SDK
or a paired native client to write.

Chat's standalone mode has its own retained local notes and transactional
reviewed imports in IndexedDB. It explicitly has no connected familiar.
Cave-backed Chat remains read-only through its frozen installed SDK; local
notes never substitute for disconnected canonical content.

## Keep one transcript owner

`ConversationFile.sessionId` remains the visible conversation identity.
`harnessSessionId` may rotate as the runtime resumes or replaces a session.
Chapters are indexes into the selected branch, not another transcript store.

Use this ownership order:

```text
ConversationFile
  -> resolveActivePath(turns, activeLeafId)
  -> exact-conversation chapter references
  -> Cave or Chat presentation
```

Do not sort raw turns into one transcript. Sibling branches are alternatives,
not adjacent messages. Browsing a chapter must not select a different branch,
reparent turns, change the composer destination, or send any message.

Global Recent, project routes, explicit chat links, and ordinary chat remain
available. Chat's standalone local notes remain local notes. A disconnected
canonical conversation must never fall back to the local note writer.

## Define scope before aggregation

A future cross-record Ongoing projection needs all of these producer-owned
facts:

- producer instance;
- authenticated audience;
- canonical familiar root and revision;
- approved access realm;
- exact source conversation and branch.

`familiarId`, display name, model, and runtime directory are not substitutes
for that tuple. Current legacy records do not prove it. Keep them separately
addressable and context-unverified rather than inferring permissions from
their labels.

The existing paired Client v1 authority is a same-user, same-machine boundary.
It is not a new multi-user or project-sharing ACL. An additive read operation
must retain the trusted ingress, authenticated credential, required scope,
bounded pagination, and authority inventory used by existing reads.

## Use stable chapter references

The chapter algorithm is `utc-day-v1`. Walk the active branch in source order.
A new contiguous run of UTC dates starts a new chapter, including when
timestamps move backwards. A chapter reference identifies its source
conversation and first source turn. Changing local timezone must not change
that reference.

Accept only `YYYY-MM-DDTHH:mm:ssZ` or
`YYYY-MM-DDTHH:mm:ss.SSSZ`, with a proleptic Gregorian calendar round trip.
Keep four-digit years literal, including year zero; do not apply a platform's
historical calendar cutover or reinterpret years below 100 as 1900-based.
Numeric offsets and noncanonical fractional precision are not accepted by
`utc-day-v1`.
Resolve the complete source branch, including system turns, before indexing.
Dropping a system ancestor before walking the tree can sever its descendants.

Reject duplicate turn IDs and invalid timestamps for the index. Do not
fabricate a valid-looking chapter by dropping malformed rows. Keep the
ordinary conversation accessible when chapter metadata is unavailable.

A leading partial page cannot establish a stable chapter start. Disclose
partial history rather than presenting that page's first turn as the
beginning of the complete chapter. A missing, deleted, or branch-replaced
anchor is unavailable, not permission to jump to an arbitrary nearby turn.

The [cross-client reference vectors](../fixtures/familiar-continuity-v1.json)
cover date runs, clock reversals, leap days, historical calendar boundaries,
duplicate IDs, and invalid timestamps. They describe source-ordered input,
not a new branch resolver or authorization grant.

Store navigation references only in continuity preferences. Do not put
transcript text, reviewed excerpts, context grants, or bearer material there.
Scope preferences and late responses to their source identity.
The ordinary conversation response carries an encoded producer-instance
header. The browser keeps that stamp on the cache envelope, outside the
transcript. Opt-in restoration rejects unstamped or mismatched memory and
offline caches. A conflicting live producer disables mutation controls and
asks you to reload instead of treating the old installation as the new one.

## Context is a separate execution contract

A new native runtime ID does not prove Fresh context.
`src/app/api/chat/send/route.ts` assembles daily memory, operator context,
Knowledge Vault material, task context, and the familiar contract. Several
recovery paths call `buildResumeRetryPrompt` to replay bounded active history.
The runtime may also load workspace instructions and retain native state.

Before enabling any selected-context mode, the execution owner must accept a
versioned manifest with:

- exact familiar root and revision;
- source references, revisions, and content digest;
- mandatory identity and policy;
- selected optional history, memory, project, and attachment categories;
- truncation and effective runtime scope;
- an accepted attempt identity and retention profile.

Bind the receipt to the actual launch, not just a UI preview. Revalidate on
resume and retry. Identity and safety context remain mandatory in Fresh.
Never repurpose the `enhance` origin to suppress ordinary startup context.

Coven's `psyche.execution_binding.v1` is a closed Psyche tuple. Its existence
does not admit an ordinary-chat context manifest. Do not add renderer-owned
fields to it or treat a caller-supplied digest as verified familiar identity.

No isolated or Temporary execution profile is qualified by the navigation
increment.

### Existing identity authority prerequisite

The canonical
[`familiar.embodiment_binding.v1` profile](https://github.com/OpenCoven/familiar-contract/blob/13d150a32a817da19bb4e5053f2205b15db0bb0a/rfcs/RFC-0001-familiar-contract.md)
already defines exact embodiment. Consume that profile rather than creating
another identity schema. It requires a verified identity bundle, a trusted
Ed25519 attestation, a current authoritative ledger observation, and an atomic
eligibility check and binding commit.

The inspected ordinary-chat path has no operational issuer and ledger source
for those facts. A local path hash, renderer-supplied root, test signing key,
or cached active flag cannot supply them. Ordinary-chat consumption and
positive admission are remaining implementation work, not something an open
issue or unpublished package inherently prevents. Coven now parses and fences
ordinary-chat intent but explicitly refuses unsupported admission. It has no
production acceptance path. Keep exact-identity
execution unavailable until its canonical trust and ledger integration is
operational and the adapter profile is qualified.

Side-record persistence, ordered import locks, receipts, and tombstones are
implemented independently of execution. They must not be presented as working
side-chat execution before
identity admission and an enforced adapter context profile are available.

## Custody inventory

These are inspected source behaviors, not deletion certifications.

| Copy or state | Existing owner and behavior | Required before Temporary |
| --- | --- | --- |
| Cave transcript | `cave-conversations.ts` writes conversation JSON; deletion also keeps a non-content fence; retained drafts have generations and custody receipts | Qualified expiry policy and all-custodian cleanup, not just transcript deletion |
| Cave list tombstone | `sacrificeSessionLocal` hides a session; its daemon row remains intact | Distinguish visibility from content deletion |
| Attachments | `server/chat-attachment-store.ts` uses a separate store; the opportunistic age sweep is 180 days | Per-policy ownership and bounded cleanup tied to the receipt |
| Runtime resume state | `chat/send/route.ts` retains or rotates native session IDs and may replay history | Adapter-specific cancellation, purge, and no-resume evidence |
| Daemon session row | Separate from the Cave soft-delete state | Explicit lifecycle ownership and retained-field disclosure |
| Optional memory and Knowledge Vault | Independently assembled startup inputs | Enforced input selection and exclusion from automatic output ingestion |
| Search and derived indexes | Separate search providers and stores | Exclude at ingestion, then fence stale copies and caches |
| Client snapshots and exports | Independent client persistence and export surfaces | Defined retained copies, expiry behavior, and limitations |
| Provider logs, diagnostics, and backups | Not erased by the conversation DELETE route | Named custodian, policy, evidence, and truthful exceptions |

`DELETE /api/chat/conversation/:id` currently deletes the Cave transcript,
marks the session sacrificed, and unlinks Board cards. Its `ifEmpty=1` branch
intentionally does not sacrifice a session. Neither response proves
provider, attachment, memory, backup, or native-session deletion.

Closing a pane is navigation. It is not cancellation or discard.

## Keep mutation gates independent

Executing retained side chats require an independently accepted execution context,
durable lineage, restart recovery, and exclusion from automatic parent
retrieval. Copying ancestors into a new file does not satisfy isolation.

Bring back requires a reviewed target write. Under ordered source-retention
and target-write fences, append the inert reviewed excerpt and operation
receipt atomically. Same key and payload returns the same receipt; changed
payload conflicts. Reconcile an existing authorized target receipt before
requiring a still-live source. A target deletion needs a non-content operation
tombstone to prevent replay.

Temporary additionally requires the custody inventory above to have an
accepted profile. Keep it unavailable when any promised effect cannot be
enforced. Do not display a successful discard merely because a pane closed.

## Qualification and rollback

Keep these gates separate:

| Gate | What it establishes |
| --- | --- |
| Source and presentation | Chapter rules, reference preservation, draft safety, and rendered navigation |
| Producer and runtime | Authorized reads or accepted execution and lifecycle receipts on exact versions |
| Packed native release | The installed SDK and app journey through actual native trust and credential boundaries |

The SDK's existing read-only `0.1.0` evidence does not certify new operations.
Keep frozen tarballs and protected conformance locks unchanged. A new
operation needs an explicitly versioned candidate and its own qualification.
Source imports, browser mocks, and screenshots do not qualify the packaged
native journey.

Related owner gates are
[Chat's narrow mission execution contract](https://github.com/OpenCoven/chat/issues/155)
and [the packed SDK's real-authority qualification](https://github.com/OpenCoven/sdk/issues/38).
Neither gate is satisfied by enabling a presentation preference.

Rollback disables new navigation or admissions. Preserve original
conversations and source identities. Once mutations exist, rollback must
also preserve their import receipts and retention enforcement.
