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
picker.

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

`NewChatView` keeps its familiar-first direct/group flow and adds a Project
section:

- no familiar selected: project selection explains that a familiar comes
  first;
- loading: show progress and disable Start/Create;
- failed load: show a specific error with Retry;
- no shared project: explain that the selected familiars need access to one
  common project;
- ready: show the selected project and allow choosing another shared project.

Changing the familiar set refreshes the shared project list. A still-valid
selection remains stable; an invalid selection is replaced by the preferred
accessible default. Start/Create remains disabled until the project lookup
succeeds and a project is selected.

The project picker uses native SwiftUI controls, semantic system colors,
Dynamic Type, VoiceOver labels that include the access level, and standard
loading/error affordances. It introduces no custom animation.

### Alternate entry points

Every thread-creation path is explicit:

- the Chats new-chat sheet passes the selected root;
- direct familiar shortcuts open the same preselected new-chat flow instead of
  creating a projectless thread;
- group creation passes the shared selected root;
- `/new` inherits the current thread root;
- server-session materialization imports `project_root`;
- task/server handoffs retain their server-owned project context.

`ChatView` also guards legacy or externally materialized projectless threads.
Before the first send it loads projects for the thread's participants, selects
the preferred accessible root, and exposes the same picker. This is the
recovery path for old snapshots and future callsites, not a substitute for
fixing known constructors.

Once any server session exists, the project control is read-only and explains
that a new project requires a new chat.

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
