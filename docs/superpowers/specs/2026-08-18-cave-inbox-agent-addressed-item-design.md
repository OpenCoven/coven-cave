# Agent-addressed items in `cave-inbox.ts`

**Status:** Draft design — not yet approved or implemented
**Bead:** `cave-aaj9c`
**Date:** 2026-08-18

## Summary

`cave-inbox.ts` (`src/lib/cave-inbox.ts`, `/api/inbox`) is a human-facing
notification/reminder feed. Every existing `ItemKind` ("reminder", "agent",
"response-needed", "daily-summary", "milestone") is written *by* a familiar or
the scheduler and read *by the human operator* in the bell/Inbox UI. There is
no representation for a message written by one familiar and addressed *to*
another familiar for that familiar to read and act on.

This gap was surfaced twice: Sage's 2026-07-22 self-report recorded
`no-cross-familiar-inbox` as a persistent blocker ("the session-local sql
inbox does not route to other familiars; I falsely reported delivery to Cody
twice before catching it"), and the 2026-08-15 follow-up thread confirmed no
channel exists anywhere in the stack — not Cave's Inbox, not the Messenger
Surface (external channels only, delivery unimplemented), not the `coven` CLI
(`coven attach` only forwards human input into a live session). `cave-aaj9c`
records the confirmed root cause and asks for exactly one of two resolutions:
build a real Cave-level agent inbox, or formally document that inter-familiar
messaging goes through `bd`/GitHub/shared files instead.

This design proposes **both**, scoped narrowly: add one new `ItemKind`,
`"agent-message"`, with a required recipient, to `cave-inbox.ts` and
`/api/inbox` for same-machine, Cave-server-mediated delivery — and formally
document `bd` (already in use as the `cave-aaj9c` workaround) as the required
fallback whenever the Cave server is not running to receive the write. Neither
path is optional: the new item kind only works while the Cave desktop app's
Next.js server is up on that machine, which a headless `coven run` session is
not guaranteed to have.

## Goals

1. Give a familiar a durable, addressed way to leave another familiar a
   message inside Cave's existing Inbox store, reusing its file, lock,
   broadcast, and API surface rather than inventing a parallel store.
2. Make the recipient a first-class, required field so delivery is provable
   (`bd show`-style: "who was this for") instead of inferred from title text.
3. Let the recipient list, read, acknowledge, and dismiss its own addressed
   items through the existing generic item endpoints — no new lifecycle.
4. Document, in the same change, why this channel is same-machine-only and
   Cave-server-dependent, and what a familiar should do when it is not
   reachable (answering `cave-aaj9c`'s option (b) rather than leaving it open).

## Non-goals

- Not a chat, thread, or request/response protocol between familiars — one
  addressed, one-shot notice per item, matching the existing `"agent"` kind's
  shape.
- Not a replacement for `bd` as the durable, always-available cross-familiar
  channel. `bd` remains authoritative for anything that must survive the Cave
  server being down, a different machine, or a different Coven instance.
- Not a new transport, socket, or daemon endpoint. Delivery is the existing
  `/api/inbox` HTTP surface on the same machine's Cave server.
- Not a permissions/ACL system distinguishing which familiar may read which
  addressed item. Every item in `inbox.json` is already readable by any
  same-machine caller today (`GET /api/inbox` has no origin check); this
  design does not change that trust boundary.
- No UI work. The existing bell/Inbox surfaces already render unknown-to-them
  kinds via `inbox-feed.ts`'s fallback path; a follow-up can add a dedicated
  render/label, but it is not required for the channel to function.

## Data model — `src/lib/cave-inbox.ts`

Add one kind to the existing union and one field to `InboxItem`:

```ts
export type ItemKind =
  | "reminder"
  | "agent"
  | "response-needed"
  | "daily-summary"
  | "milestone"
  | "agent-message"; // NEW

export type InboxItem = {
  // ...existing fields unchanged...

  /**
   * Required when kind === "agent-message": the familiarId this item is
   * addressed to. Distinct from `familiarId`, which continues to mean the
   * sender/producer (unchanged for every existing kind). Absent/null on
   * every other kind.
   */
  recipientFamiliarId?: string | null; // NEW
};
```

Rationale for a new field rather than repurposing `familiarId`: every existing
consumer of `familiarId` (grouping in `inbox-feed.ts`, mute-by-familiar in
`inbox-prefs.ts`) reads it as *whose item this is for display purposes*, which
for every current kind is also the producer. Overloading it to mean "sender"
for one kind and "producer" for four others is the kind of ambiguity this
design exists to remove. `recipientFamiliarId` is unambiguous and additive —
it does not change behavior for any existing kind or consumer.

`createItem`/`NewItemInput` gain the same optional field, validated only for
this kind (see API surface below). No change to `updateItem`, `deleteItem`,
`snoozeItem`, `markDone`, `dismissItem`, or `applyBulkAction` — an
agent-addressed item is a normal `InboxItem` once created and rides the
existing generic lifecycle.

Status on creation follows the existing `"agent"`/`"daily-summary"`/
`"milestone"` rule in `createItem` (delivered immediately as `"fired"` when no
`fireAt` is given, since this is a notice, not a scheduled reminder):

```ts
const status: ItemStatus =
  (input.kind === "agent" ||
    input.kind === "daily-summary" ||
    input.kind === "milestone" ||
    input.kind === "agent-message") && // NEW
  !input.fireAt
    ? "fired"
    : "pending";
```

## API surface — `/api/inbox`

**`POST /api/inbox`** (`src/app/api/inbox/route.ts`): accept
`recipientFamiliarId` in the body and require it when `kind ===
"agent-message"`, mirroring the existing `reminder` + `fireAt` requirement:

```ts
if (kind === "agent-message" && !body.recipientFamiliarId) {
  return NextResponse.json(
    { ok: false, error: "agent-message requires recipientFamiliarId" },
    { status: 400 },
  );
}
```

Default `source` to `"agent"` for this kind, same as `"agent"` today. The
sender identifies itself via the existing `familiarId`/`sessionId` fields —
unchanged, just now meaning "who sent this" rather than "who this is grouped
under."

**`GET /api/inbox`**: add an optional recipient filter, additive to the
existing `status` filter:

```ts
const to = url.searchParams.get("to");
const items = file.items.filter(
  (i) => (!filter || i.status === filter) && (!to || i.recipientFamiliarId === to),
);
```

A familiar checks its own inbox with `GET /api/inbox?to=<familiarId>`, the
same shape as `bd ready` — one read, filtered to what's addressed to it. No
new endpoint; the existing route already has no origin check on `GET`, so no
new trust boundary is introduced by adding this filter.

No changes needed to `/api/inbox/[id]`, `/api/inbox/bulk`, or `/api/inbox/prefs`
— acknowledging, dismissing, or completing an addressed item is already the
generic per-item and bulk-action surface.

## Delivery constraint: this channel requires the Cave server

`INBOX_PATH` resolves under `caveHome()` (`~/.coven/cave/inbox.json` by
default), and every write goes through `withInboxLock`, an **in-process**
`globalThis` promise chain inside the single Next.js server process. A
familiar's `coven run` session is a separate OS process; it cannot join that
lock. So the sender-side contract for this design is:

- **A producing familiar must call `POST /api/inbox` over HTTP** (the running
  Cave server on that machine), never write `inbox.json` directly. Only the
  Cave server process holds the write lock and the broadcast (SSE) fan-out
  that keeps the bell UI live.
- **This only works while the Cave desktop app (or an equivalent headless
  server) is running on that machine.** A `coven run` session launched
  without Cave's Next.js server up has no local port to call.

This is exactly the gap `cave-aaj9c` asked to have resolved one way or the
other. The answer this design gives: **prefer this channel when the Cave
server is reachable; when it is not, or when the recipient may be on a
different machine or Coven instance, fall back to `bd`** — already the
practice this bead itself demonstrates by existing. Document both, rather
than pretending the new item kind is a general-purpose always-on channel it
cannot be.

## Verification

- Add unit coverage next to the existing `cave-inbox-create.test.ts` /
  `cave-inbox-bulk.test.ts`: creating an `"agent-message"` item without
  `recipientFamiliarId` is rejected at the route layer; creating one with it
  round-trips through `createItem`/`loadInbox`; `GET /api/inbox?to=<id>`
  returns only items addressed to that id, unaffected by unrelated
  `familiarId`-tagged items from existing kinds.
- Extend `inbox-feed.test.ts`'s kind-label and ordering assertions to cover
  `"agent-message"` so it does not silently fall through as an unlabeled kind
  in the bell UI.
- Run the focused `src/lib/cave-inbox*.test.ts` and `inbox-feed.test.ts`
  suites, plus a typecheck of the touched files.

## Open questions for a follow-up iteration

- Whether `inbox-feed.ts` should render `"agent-message"` distinctly from
  `"agent"` in the bell UI, and whether the recipient's *own* session (a
  `coven run` process) should poll `GET /api/inbox?to=<id>` on startup the way
  it already polls `bd ready` — this design makes the poll possible but does
  not wire it into any familiar's runtime harness.
- Whether `MUTABLE_KINDS` (`inbox-prefs-shape.ts`) should include
  `"agent-message"` for per-kind muting, and how that interacts with a human
  operator wanting to see all agent-to-agent traffic regardless of mute state.
