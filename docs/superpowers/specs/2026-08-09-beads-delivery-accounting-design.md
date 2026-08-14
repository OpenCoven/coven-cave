# Beads delivery accounting across desktop and native iOS

**Status:** Approved design  
**Bead:** `cave-tjact`  
**Date:** 2026-08-09

## Summary

Keep Beads as the canonical repository-work tracker while making its delivery
state visible in the places where operators already work:

- Desktop Tasks gains a complete Beads overview above the existing ready/PR
  Work Queue.
- Board cards may explicitly link to one Bead through a structured `beadRef`.
- Native iOS shows read-only delivery state only for Board cards that carry a
  `beadRef`.
- New Beads created through canonical Cave surfaces must declare one platform
  ownership label: `surface:ios`, `surface:desktop`, or `surface:shared`.

The design does not mirror the full Beads backlog into Board, expose arbitrary
repository paths to mobile, or make iOS a Beads mutation client.

## Goals

1. Account for the complete unfinished Beads population on desktop without
   turning every issue into an actionable Work Queue card.
2. Make stale `in_progress` state visible and distinguish ordinary drift from
   week-old status debt.
3. Link a Board task to repository delivery state only when an operator chooses
   to do so.
4. Show that linked delivery state in native iOS without exposing the local
   Beads adapter or filesystem.
5. Prevent routine Board cleanup from silently deleting linked mirrors.
6. Improve platform ownership hygiene for newly created Beads while
   grandfathering the existing backlog.

## Non-goals

- Synchronizing all Beads into Cave Board.
- Editing, claiming, closing, or creating Beads from native iOS.
- Exposing `/api/beads` to tailnet/mobile requests.
- Backfilling platform labels across existing Beads.
- Inferring Bead links from notes, titles, labels, or PR text.
- Replacing the existing ready/PR lanes or GitHub bridge.

## Source of truth and boundaries

Beads remains the durable repository-work source of truth. Cave Board remains
the execution surface for user-facing tasks. A link connects the two records;
it does not establish bidirectional synchronization.

The boundaries are:

- `/api/beads` remains local-origin-only and may continue accepting an explicit
  desktop-selected repository root.
- Mobile delivery reads are derived only from `beadRef` values already stored
  on Board cards.
- A mobile request never supplies a Bead ID, project ID, or repository path to
  the delivery endpoint.
- Beads subprocesses continue to run through `runBdCommand` with argv arrays,
  a trusted working directory, a bounded timeout, and a bounded output buffer.

## Board data model

Add an optional structured reference:

```ts
export type CardBeadRef = {
  id: string;
  projectId: string;
};

export type Card = {
  // existing fields
  beadRef?: CardBeadRef | null;
};
```

The project ID is part of the reference even though a card also has a
`projectId`. A task's execution project may change later; that must not silently
repoint its delivery link to another repository.

Normalization rules:

- `id` is trimmed, bounded, and limited to a safe Beads identifier shape.
- `projectId` must resolve through the trusted Cave project registry.
- The resolved project must contain a safe, non-symlinked `.beads` directory.
- Link creation validates that `bd show <id> --json` resolves in that workspace.
- Invalid legacy or hand-edited references are dropped during normalization
  rather than making the whole Board unreadable.

The field is optional, so existing persisted Board files and older iOS clients
remain compatible.

## Desktop Beads overview

Add an overview read mode backed by a pure delivery-normalization module.

The server runs:

```text
bd list --all --json
bd ready --json
```

and returns a bounded DTO:

```ts
type BeadsDeliveryOverview = {
  generatedAt: string;
  totals: {
    remaining: number;
    ready: number;
    open: number;
    inProgress: number;
    blocked: number;
    deferred: number;
  };
  stale: {
    olderThan24h: number;
    olderThan7d: number;
    oldest: BeadDeliveryItem[];
  };
  surfaceHygiene: {
    ios: number;
    desktop: number;
    shared: number;
    missing: number;
    conflicting: number;
  };
};
```

Closed Beads do not contribute to `remaining`. The server includes at most 20
oldest stale rows, sorted by `updated_at`, and omits descriptions, notes,
comments, local paths, and raw command errors.

`in_progress` becomes stale after 24 hours without an update. Items older than
7 days receive the stronger warning tier. These thresholds are shared constants
used by the DTO builder and UI tests.

The overview is cached briefly per canonical repository root. A failed overview
refresh does not blank the existing ready/PR queue or discard its last good
overview.

## Desktop Work Queue behavior

Tasks -> Work Queue keeps its existing action lanes. A compact overview band
appears above them with:

- Remaining
- Ready
- Open
- In progress
- Blocked
- Deferred
- Unclassified

`Unclassified` is the sum of missing and conflicting platform ownership labels.
The detail disclosure distinguishes those two causes.

When stale work exists, the overview shows a warning strip with the 24-hour and
7-day counts plus the oldest few items. "Show all" expands only the bounded
server result. This is status hygiene, not a second issue browser.

The overview has independent loading, failure, freshness, and retry state. The
existing Work Queue remains usable when the overview is unavailable.

All new UI uses existing Cave tokens and primitives, includes visible
focus rings, exposes disclosure state to assistive technology, pairs state
color with text, and announces explicit refresh failures or recovery.

## Explicit Board linking

The desktop Board inspector gains a Delivery field:

1. Select a configured project.
2. Enter a Bead ID.
3. Validate and link.

The field shows current Bead status, priority, platform ownership, readiness,
and update age. It offers explicit unlinking.

Requests that set or clear `beadRef` are local-origin-only even though ordinary
Board PATCH requests remain available to paired mobile clients. This keeps the
native app read-only with respect to Beads without weakening existing mobile
task editing.

No create flow automatically links a Bead. No title, note, label, PR, or issue
reference is interpreted as a link.

## Linked-card retention

A card with `beadRef` is protected from routine deletion:

- Clear done skips linked cards and reports how many were preserved.
- Bulk deletion skips linked cards and reports how many were preserved.
- `DELETE /api/board/{id}` returns `409 linked_bead_requires_unlink` for a
  linked card.
- The operator removes the Delivery link before deleting the card.
- Native iOS cannot unlink, so linked tasks cannot be deleted from iOS.

The server-side delete guard is authoritative. Client filtering improves the
experience but is not the retention boundary.

This protection addresses newly explicit links. Existing prose-only or
label-only Board mirrors are not guessed or migrated automatically; they must
be linked deliberately.

## Mobile-safe delivery endpoint

Add:

```text
GET /api/board/delivery
```

The request accepts no project or Bead parameters. The handler:

1. Loads Board cards.
2. Collects valid `beadRef` values.
3. Caps the number of linked cards and distinct projects.
4. Resolves each project ID through trusted Cave project configuration.
5. Resolves a safe Beads workspace for each project.
6. Runs one `bd list --all --json` per unique project, not one subprocess per
   card.
7. Returns only the linked cards' delivery snapshots.

Response:

```ts
type BoardDeliveryResponse = {
  ok: true;
  generatedAt: string;
  cards: Record<string, BoardDeliveryState>;
};

type BoardDeliveryState =
  | {
      state: "available";
      bead: {
        id: string;
        title: string;
        status: "open" | "in_progress" | "blocked" | "deferred" | "closed";
        priority: number;
        platform: "ios" | "desktop" | "shared" | "unclassified";
        ready: boolean;
        updatedAt: string | null;
        stale: "none" | "older_than_24h" | "older_than_7d";
      };
    }
  | { state: "missing" }
  | { state: "unavailable" };
```

One failed project produces `unavailable` only for cards linked to that project.
One missing Bead produces `missing` only for that card. The response never
contains repository roots, Beads stderr, descriptions, notes, comments, owner
emails, or unrelated issues.

## Native iOS behavior

`BoardCard` decodes the optional structured `beadRef`. `AppModel` fetches the
batch delivery endpoint alongside task data and stores delivery state keyed by
card ID.

`TaskDetailView` renders a read-only Delivery card only when `beadRef` exists:

- Bead ID and title
- status and priority
- platform ownership
- ready/waiting state
- last update and stale warning

The section says "Delivery status unavailable" for `missing` or `unavailable`
states and leaves the rest of the task usable. It provides no link, unlink,
claim, close, or mutation action.

The native Tasks list remains a Cave Board surface. There is no project-wide
Beads tab or global backlog count on iOS in this release.

## Platform ownership enforcement

Every newly created Bead through canonical Cave surfaces must carry exactly one
platform ownership label:

- `surface:ios`
- `surface:desktop`
- `surface:shared`

Specific surface labels such as `surface:chat`, `surface:workflow`, or
`surface:github` may coexist. They do not satisfy the platform requirement.

Add a canonical wrapper:

```text
pnpm beads:create --surface <ios|desktop|shared> <bd create arguments>
```

The wrapper:

- requires one valid `--surface`;
- rejects conflicting platform labels supplied through `--labels`;
- merges the platform label with other labels;
- forwards remaining arguments to `bd create` as argv entries;
- preserves the child process exit code and JSON/stdout behavior.

The Cave `/api/beads` create action requires the same `surface` enum and applies
the same validation. Existing in-app create callers declare `shared` unless
their workflow has narrower ownership.

Raw `bd create` has no repository-defined pre-create hook and remains technically
possible. Existing issues are grandfathered. A local audit command and the
desktop Unclassified count make direct-CLI violations visible instead of
claiming an unenforceable universal gate.

Documentation and agent guidance use the wrapper as the canonical create path.

## Error handling

- Malformed Beads JSON fails the affected overview or project delivery source;
  it is never treated as an empty successful list.
- Overview and ready/PR queue failures are independent.
- Mobile delivery failures are per project or per card.
- Link validation returns stable 4xx codes for invalid IDs, missing projects,
  unsafe workspaces, and missing Beads.
- Linked-card deletion returns a stable 409 code.
- No broad catch turns a command failure into an empty success.
- UI error copy names the failed capability and provides a retry or repair
  action where one exists.

## Verification

Targeted coverage includes:

- pure overview normalization, status totals, ready count, surface hygiene, and
  24-hour/7-day stale thresholds;
- Beads overview route project isolation, local-origin enforcement, bounded
  output, and failure propagation;
- canonical create wrapper argument parsing, label merge, conflicts, and exit
  passthrough;
- `/api/beads` create surface validation and updated create callers;
- Board normalization, create/PATCH validation, local-only `beadRef` mutation,
  and linked delete conflict;
- Clear done and bulk delete preserving linked cards;
- mobile delivery endpoint project grouping, bounds, redaction, missing Beads,
  and partial project failure;
- desktop overview rendering and independent degradation;
- Swift `BoardCard` and delivery DTO decoding;
- native task-detail available, missing, unavailable, and stale states.

Run the smallest existing TypeScript/Node test selectors covering these files,
then `pnpm typecheck`, the targeted iOS tests, and an iOS simulator build when
the Swift surface changes.

## Rollout

1. Land the shared types, normalization, overview endpoint, and platform-create
   enforcement.
2. Add the desktop overview.
3. Add `beadRef`, local desktop link management, and deletion protection.
4. Add the bounded Board delivery endpoint.
5. Add native iOS decoding and the linked-task Delivery section.
6. Audit current unfinished Beads and report legacy unclassified counts without
   bulk backfilling them.

No rollout step rewrites existing Beads or Board records automatically.
