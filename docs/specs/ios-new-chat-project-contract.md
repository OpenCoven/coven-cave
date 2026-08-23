# iOS New-Chat Project Contract Design

## Goal

Make native iOS chat obey the same project-launch contract as desktop Chat:
every user-facing first turn must name a registered project that every selected
familiar can access. Preserve that project through retries, offline replay,
groups, local persistence, and `/new`, while returning actionable server errors
instead of the generic `Server returned status 400.` symptom.

The server's fail-closed project gate remains authoritative. This work repairs
the native client contract; it does not restore the removed familiar-workspace
fallback.

## Confirmed Failure

`CaveClient.SendBody` has no `projectRoot`, and `ChatThread.stream` therefore
sends a fresh turn with neither `sessionId` nor `projectRoot`.
`/api/chat/send` can recover a project from an existing conversation or daemon
session, but a new thread has neither. `authorizeChatProjectLaunch` returns:

```json
{
  "ok": false,
  "code": "project_root_required",
  "error": "Choose a project this familiar can access before starting chat."
}
```

The iOS streaming client checks only the HTTP status, discards that JSON
envelope, and converts it to `CaveError.badResponse(400)`. The UI consequently
loses both the recovery instruction and the machine-readable error code.

## Chosen Approach

Use a project-bound thread contract.

- `ChatThread` owns the canonical project root for the lifetime of a local
  conversation.
- `ThreadSnapshot` persists the root so reconnects, app restarts, queued sends,
  and retries cannot lose it.
- A fresh thread cannot send until the client has resolved a project accessible
  to all participants.
- The project is editable only before the first server session exists. After
  any familiar has a `sessionId`, starting in another project means starting a
  new thread.
- The server revalidates registration and access on every send, so client-side
  filtering is guidance rather than an authorization boundary.

Rejected alternatives:

- A send-time-only picker would leave thread persistence, offline replay, and
  alternate constructors structurally projectless.
- An implicit server fallback would weaken the security boundary that produced
  the regression and make execution provenance ambiguous.
- Assigning an arbitrary all-projects default without familiar scoping could
  present an inaccessible project and merely replace the current 400 with a
  403.

## Data Contract

### Project models

`ProjectInfo` gains optional `access: ProjectAccessLevel?`. Unscoped project
responses remain decodable with `nil`; familiar-scoped `/api/projects`
responses carry the effective access level.

`CaveClient` exposes:

- `projects()` for existing all-project developer surfaces;
- `projects(familiarId:)` for one launchable familiar scope;
- `projects(familiarIds:)` for a stable intersection across a direct or group
  roster.

The group helper fetches each distinct familiar scope, intersects by project
ID, preserves the canonical project record, and assigns the least permissive
effective access across the group. Empty participant input produces no
launchable projects.

### Thread persistence

`ThreadSnapshot` and `ChatThread` gain optional `projectRoot`.

- Optional decoding keeps pre-change snapshots readable.
- New thread factories accept a project root explicitly.
- `openServerSession` derives the root from the server session's
  `project_root`.
- Snapshot round trips preserve the exact canonical root.
- Duplication and `/new` inherit the root unless the user chooses another
  accessible project before the new thread's first turn.

No project ID is persisted. The root is the chat launch wire contract and the
server remains responsible for mapping it to the current registered project.
If a project moves or disappears, the next scoped refresh or server rejection
requires a fresh selection rather than silently relabeling the thread.

### Send invariant

`CaveClient.SendBody` gains `projectRoot`.
`ChatThread` constructs every direct/group first turn, retry, and offline replay
from its persisted root. Existing resumed sessions also send the root when it
is known; the server's persisted conversation provenance remains
authoritative.

`ChatThread` rejects a network send locally when a new thread has no project.
It does not append a user turn or create streaming placeholders in that state.
This invariant protects any future constructor that bypasses the visible
recovery UI.

## Selection and UI Flow

### Shared selection policy

A small pure selection helper owns:

- stable alphabetical ordering;
- intersection of familiar-scoped project lists;
- validation of the current selection after participant or permission changes;
- defaulting to the most recently used root that remains accessible;
- falling back to the first accessible project.

This helper is unit-tested independently of SwiftUI and reused by the visible
new-chat and in-thread recovery flows.

### New Chat

`NewChatView` keeps its familiar-first direct/group flow, but normal creation
is now fixed to the shell's active registered project:

- the Project section shows the active project name and root, with copy that a
  different root requires switching projects in Chats first;
- the familiar roster comes only from `app.projectFamiliars`, so every new
  chat participant already belongs to the active project context;
- Markdown import captures the active project ID/root plus the explicit
  familiar roster before presenting the document picker, then revalidates that
  same context on callback; if the app switched projects, fell back to
  Unassigned, or revoked any selected familiar while the picker was open, the
  import aborts with actionable guidance instead of silently restoring under a
  different roster or root;
- Start/Create stays disabled when the active project is unavailable, when the
  selected familiar leaves the active project, or when an Unassigned recovery
  context is on screen.

Unassigned is recovery-only. It still lists legacy projectless or
unregistered-root chats, but it does not offer a normal New Chat flow.
Actionable guidance tells the operator to refresh Chats or switch to a
registered project instead.

### Alternate entry points

Every thread-creation path is explicit:

- the Chats new-chat sheet passes the active registered root;
- direct familiar shortcuts open the same fixed-root new-chat flow instead of
  creating a projectless thread;
- familiar landing shortcuts outside `/new` (drawer roster, project-scoped
  familiar lists, slash-command switching, forwarding) reuse the local landing
  chat first, otherwise materialize the newest eligible project-scoped server
  session, and only then create a fresh project-bound direct chat; forwarding
  binds that server session synchronously before it sends, and any deferred
  history reload waits for a confirmed successful send so queued, failed,
  cancelled, or otherwise unacknowledged local forward bubbles are never
  replaced; Unassigned never synthesizes a new landing chat;
- global search familiar results resolve the familiar's global landing
  conversation across every known context: prefer the most recent eligible
  local landing thread, otherwise the newest server-only session, then route
  through the canonical thread-open helper so the app switches into that
  conversation's owning project or Unassigned before opening; only a familiar
  that belongs to the current active registered project may synthesize a fresh
  chat from global search, and every other no-history case surfaces actionable
  guidance instead;
- the in-chat session picker passes the visible thread's explicit project
  context into `FamiliarThreadsView`, so its local rows, server-only rows,
  unread clears, counts, search, and replacement-chat affordances stay scoped
  to the conversation being viewed even if the app-wide project selection
  changes underneath it;
- direct voice calls inherit the thread's persisted `projectRoot`: OpenAI live
  voice pre-creates a session through `POST /api/chat/conversation` before it
  mints the provider grant through `POST /api/voice/session`, while Apple
  native voice carries the thread root on a fresh first turn until the server
  returns a `sessionId`; chats whose root is missing, invalid, or Unassigned
  hide the call action and continue to surface project-recovery guidance
  instead of attempting a nil-root call;
- every thread-open path (deep links, drawer recents, global search, task
  chat opens, familiar landing, forwarding destinations, session switching)
  resolves the thread root through the current registered-project resolver,
  switches the app into that canonical project or Unassigned before
  publishing the open intent, and surfaces actionable recovery guidance
  instead of silently opening under the wrong project when metadata is
  malformed; ChatsHome and the in-chat session picker both validate the
  selected local or materialized server thread before presenting `ChatView`,
  and malformed dot-segment roots stay visible only as Unassigned recovery
  rows for inspect/export/delete flows;
- group creation passes the active root;
- `/new` starts in the active project only when every carried familiar still
  belongs to that project; otherwise it blocks with actionable recovery
  guidance rather than creating an invalid roster;
- legacy projectless sessions offer a replacement-chat path rather than
  silently adopting the current project, and that replacement path applies the
  same roster validation as `/new`;
- server-session materialization imports `project_root`;
- session refresh backfills authoritative `project_root` values into restored
  local threads that already know a `sessionId`, so legacy snapshots leave
  Unassigned as soon as the server can prove their root again — even when
  task history fails — unless the operator explicitly selected Unassigned;
- task entry points keep existing server-session `project_root` values, fetch
  or reuse the authoritative session list before materializing a linked
  session, prefer the server session's `familiarId` over any stale task or
  caller fallback when rebuilding a local thread, only downgrade an existing
  local copy to recovery-only after the linked session is confirmed missing or
  confirmed projectless, preserve the local copy unchanged on transient linked
  session load failures, and an unlinked task without a server session starts
  in that task's registered project root after the app switches into the
  matching project context;
- Unassigned, deleted-project, or access-denied task launches block with
  recovery guidance instead of creating a projectless thread.

Project/grants/familiars remain the fail-closed bootstrap boundary. Session
and task history only help choose the default project context: if those
best-effort history reads fail, iOS keeps the restored or alphabetical
registered-project fallback and surfaces the stale/error signal without
dropping back to the project-context gate.

`ChatView` also guards legacy or externally materialized projectless threads.
Before the first send it loads projects for the thread's participants, selects
the preferred accessible root, and exposes the same picker. This is the
recovery path for old snapshots and future callsites, not a substitute for
fixing known constructors.

Once any server session exists, the thread stays recovery-only when it lacks a
registered project. It can be inspected, exported, deleted, or replaced, but
it never silently adopts the active project.

## Structured Error Handling

Introduce a bounded chat error-envelope decoder for non-2xx streaming
responses. It reads at most 64 KiB and accepts:

- `error`;
- `code`;
- optional `hint`.

`CaveError` gains a structured server-response case containing status, code,
and user-safe message. Its localized description prefers the server message
and falls back to the existing status text when the response is empty,
oversized, malformed, or non-JSON.

Project launch codes (`project_root_required`, `project_root_unavailable`,
`project_root_not_directory`, `project_root_invalid`,
`project_not_registered`, and `project_access_denied`) mark a pre-session
thread as needing project selection. The failed assistant placeholder becomes
an actionable error, and Chat surfaces the project picker before retry. No
automatic retry occurs after a user-visible project change.

Response bodies are bounded, never logged with credentials, and remain subject
to the server's existing redaction rules.

## Regression Coverage

### Native XCTest

Add behavior tests that prove:

1. `SendBody` encodes `projectRoot` for a first turn with no `sessionId`.
2. `ChatThread` builds direct, group, retry, and queued replay requests from
   the persisted root.
3. Sending a new projectless thread performs no network work or transcript
   mutation.
4. Snapshot round trips preserve the root and a legacy snapshot without the
   field still decodes.
5. Shared-project intersection, least-access merging, current-selection
   retention, recent-project defaulting, and empty intersections are correct.
6. The structured error decoder preserves status, code, message, and fallback
   behavior for malformed or oversized bodies.
7. A project launch error before session creation reopens selection; a normal
   transport error does not.
8. Task chat entry points use the task's registered root for direct and
   familiar-picker launches, block Unassigned/deleted/inaccessible tasks, keep
   mismatched server sessions on the server-authored root, and rebuild stale
   local task threads with the server-authored familiar/session binding;
   concurrent opens of the same authoritative task session still collapse onto
   one repaired local thread and one stable task↔thread link; a confirmed
   missing linked session or missing `project_root` may downgrade an existing
   local copy to recovery-only, but a transient session-load failure must leave
   any existing local thread unchanged.
9. Forwarding a just-materialized server-only landing chat reloads history only
   after an acknowledged send, while queued, failed, cancelled, and
   unacknowledged attempts preserve the local transcript.
10. Fresh voice calls either create the server session from the thread's
    registered root before provider-grant minting, or send the first native
    turn with that root until the stream binds a `sessionId`; the native voice
    path publishes that bound session back to the thread as soon as `.session`
    or `.done` arrives so a hangup mid-reply still resumes the same session;
    once the operator hangs up, late assistant transcript/audio/state updates
    stay suppressed even if that binding lands afterward;
    when that first bound session belongs to a task-linked thread, iOS PATCHes
    the card's `sessionId` immediately instead of waiting for a later text
    reply; no production first-turn voice `SendBody` hardcodes
    `projectRoot: nil`.

### Linux CI contract

Add a focused `scripts/ios-chat-project-contract.test.mjs` guard and wire it
into the `mobile` suite. The guard pins the cross-file contract that neutral
Linux CI can inspect:

- thread snapshot and runtime state include `projectRoot`;
- send bodies encode it;
- known constructors pass or inherit it;
- New Chat cannot start without a resolved project;
- structured stream errors decode the response envelope;
- the native behavior test files remain present.

The guard supplements XCTest; it does not replace behavior coverage.
`scripts/check-tests-wired.mjs` must confirm the new guard is reachable from
`pnpm test:mobile`.

### Server contract

Keep the existing fail-closed launch tests and add a route-level first-turn
fixture proving:

- an iOS-shaped request without `projectRoot` returns
  `project_root_required`;
- the same first-turn shape with an accessible registered root passes the
  authorization boundary;
- project access remains checked server-side even if a client submits a root.

## Verification

Before handoff:

1. Observe each new native regression test fail for the intended missing
   behavior before production edits.
2. Generate the Xcode project from
   `apps/ios/CovenCave/project.yml`.
3. Run the full `CovenCaveTests` suite on the available iPhone simulator.
4. Build the iOS app target for the simulator.
5. Run the Linux-runnable contract guard and `pnpm test:mobile`.
6. Run focused project-launch and chat-send route tests.
7. Run test wiring, lint, typecheck, and the relevant app/API suites.
8. Walk the design language shipping checklist for the new SwiftUI states,
   including VoiceOver names, Dynamic Type, loading/error recovery, and
   reduced-motion behavior.
9. Inspect the final diff and confirm the canonical checkout's unrelated
   changes were never touched.

## Exclusions

- No relaxation of project registration or familiar access requirements.
- No automatic grant creation from the phone.
- No project management redesign; users continue to create projects and grants
  through existing surfaces.
- No cross-project mutation of an established server conversation.
- No unrelated refactor of desktop Chat, project storage, or the permission
  model.
