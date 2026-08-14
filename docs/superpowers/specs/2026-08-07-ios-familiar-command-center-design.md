# iOS Familiar command center

**Status:** Approved design  
**Bead:** `cave-9rwd`  
**Goal:** `ios-familiar-profile-dashboard`

## Summary

Build one persistent native iOS destination for each Familiar. The destination
uses a compact identity header, a primary Chat action, and three tabs:
Overview, Profile, and Analytics.

The first client is iOS, but the backend work is a shared, versioned Familiar
dashboard read contract. Existing web Profile and Analytics routes remain
unchanged during this phase.

## Problem

The iOS app has a Familiar roster and a substantial `FamiliarDetailView`, but
it does not have a coherent Familiar command center:

- `FamiliarsListView` opens an information page with identity, four summary
  stats, model defaults, permissions, and a Chat button.
- Chats intentionally use a separate familiars-first flow where selecting a
  Familiar opens its current conversation.
- Tasks, sessions, reminders, profile facts, and analytics are available
  through separate APIs and surfaces.
- Familiar analytics exists on the web, but its multi-source workbench is too
  dense and request-heavy to reproduce directly on a phone.
- Avatar display exists on iOS, while bidirectional avatar mutation is owned by
  `cave-nv1dk`.

Users therefore cannot inspect a Familiar's identity, live work, attention
needs, reminders, and evidence-backed trends in one native place.

## Scope

### In scope

- Broaden `cave-9rwd` into the umbrella for a shared Familiar dashboard read
  contract, with iOS as the first client.
- Replace the current iOS Familiar detail destination with a unified tabbed
  hub.
- Add an operational Overview with live status, current work, assigned tasks,
  sessions, attention signals, and Familiar-scoped reminders.
- Expand Profile into the canonical native identity and configuration view.
- Add a mobile-native Analytics digest with explicit definitions, periods,
  sample counts, freshness, and unavailable states.
- Refresh visible data immediately, on pull-to-refresh, and every 30 seconds
  while the hub is active.
- Preserve last-known-good section data in memory during partial refresh
  failures.
- Cover accessibility, privacy, performance, API contracts, Swift behavior,
  and native build verification.

### Out of scope

- Replacing the familiars-first Chats flow. A Familiar selected from Chats
  still opens its current chat.
- Duplicating session management inside the hub. Session selection and thread
  management remain in the existing chat configuration/session picker.
- Rebuilding the web Familiar Profile or Analytics routes.
- Reproducing desktop analytics tables, heatmaps, hover interactions, or shell
  chrome on iOS.
- Inventing a composite Familiar "performance score."
- Implementing avatar transport or storage. The Profile tab consumes
  `cave-nv1dk` when that dependency lands.
- Persisting task, session, profile, or analytics dashboard snapshots to disk
  in the first release.

## Navigation and information architecture

The global navigation drawer keeps its Familiars destination.
`FamiliarsListView` continues to show the roster, loading, cached-data warning,
empty state, retry action, and live presence.

Selecting a roster row opens:

```text
FamiliarHubView
├── FamiliarHubHeader
│   ├── avatar + presence
│   ├── name + role
│   ├── freshness/status summary
│   └── Chat
└── tabs
    ├── Overview
    ├── Profile
    └── Analytics
```

The header remains visible while switching tabs. Chat is the only
accent-filled primary action. Secondary actions use normal bordered or plain
controls.

On iPhone, the hub is pushed from the roster. On iPad, it occupies the detail
column without changing the global drawer or Chats split-view behavior.
Selecting another Familiar replaces the keyed dashboard state rather than
reusing the previous Familiar's cards.

## Shared dashboard contract

Add:

```text
GET /api/familiars/{id}/dashboard?v=1
```

The route returns one coherent mobile read snapshot. It does not call Cave's
own HTTP endpoints. Server-side loaders read the same underlying stores and
reuse existing pure derivation functions.

Suggested module boundaries:

- `src/lib/familiar-dashboard.ts`
  - public DTO types
  - pure Overview and Analytics digest builders
  - state and freshness helpers
- `src/lib/server/familiar-dashboard-data.ts`
  - bounded server-side source loaders
  - source-level error normalization
- `src/app/api/familiars/[id]/dashboard/route.ts`
  - ID validation
  - parallel source orchestration
  - response status and serialization

The response shape is versioned and section-oriented:

```ts
type ServerDashboardSectionState =
  | "fresh"
  | "partial"
  | "empty"
  | "unavailable";

type ClientDashboardSectionState =
  | ServerDashboardSectionState
  | "stale";

type FamiliarDashboardResponse =
  | {
      ok: true;
      version: 1;
      familiarId: string;
      generatedAt: string;
      identity: FamiliarDashboardIdentity;
      sections: {
        overview: DashboardSection<FamiliarOverview>;
        profile: DashboardSection<FamiliarProfile>;
        analytics: DashboardSection<FamiliarAnalyticsDigest>;
      };
    }
  | {
      ok: false;
      error: "invalid_familiar_id" | "familiar_not_found" | "dashboard_unavailable";
    };

type DashboardSection<T> = {
  state: ServerDashboardSectionState;
  generatedAt: string;
  data: T | null;
  issues: Array<{
    source: string;
    code: string;
  }>;
};
```

`issues` contains stable machine codes, not raw provider output, filesystem
paths, credentials, task text, session titles, or profile biography.

Server section states are deterministic:

| State | Meaning |
| --- | --- |
| `fresh` | All required sources succeeded and the section contains usable data. Optional-source omissions may still appear in `issues`. |
| `partial` | At least one required source failed, but other sources produced a safe, useful section. |
| `empty` | All required sources succeeded and truthfully produced no records for the section. |
| `unavailable` | Required sources failed and no safe section data can be constructed. |

The server does not emit `stale` in version 1 because it has no dashboard
snapshot cache. `stale` is a client presentation state applied only when a
refresh fails and iOS retains a previous successful section. The retained
section keeps its original server state and `generatedAt`.

An invalid ID returns 403, matching existing Familiar path validation. An
unknown Familiar returns 404. A known Familiar returns 200 even when one or
more sections are partial. A 500 response is reserved for failure to construct
any safe dashboard response.

The route is dynamic and not browser-cacheable. The client owns its visible
refresh cadence and in-memory last-known-good state.

The core identity is required and comes from the Familiar registry that already
distinguishes found from not found. Optional identity facts such as presence,
last seen, active-session count, and avatar revision degrade to `null` without
failing the response.

Version 1 has explicit response bounds:

- serialized response: at most 128 KiB;
- assigned task rows: 6;
- active session rows: 3;
- recent non-generated session rows: 5;
- attention rows: 6;
- reminder rows: 5;
- confidence/capability reports: latest 30;
- metric snapshots: at most 100 from the trailing 30 days;
- session evidence: at most the latest 100 Familiar-scoped sessions.

The DTO includes total counts where a visible list is truncated.

## Identity and Profile data

The shared identity header contains:

- Familiar ID
- display name
- role
- pronouns
- avatar URL and revision metadata
- presence/status and last-seen value when available
- active-session count

The Profile section contains the broader native profile:

- description/purpose
- Familiar type or vocation
- runtime/harness default
- model default and provenance
- memory freshness
- voice provider, model, and voice name
- image-generation defaults when configured
- contract/capability summary
- project and tool access summary

The iOS `Familiar` model currently omits several server fields. The dashboard
DTO must model the fields explicitly rather than expanding the roster DTO until
the two contracts happen to match.

Profile editing is dependency-aware:

- Existing model selection remains editable through the current model
  inventory/mutation path.
- Existing project and tool permissions remain editable through
  `FamiliarPermissionsSheet`.
- Avatar is display-only until `cave-nv1dk` provides the native mutation and
  cross-device refresh contract.
- No disabled or nonfunctional avatar edit control is shown.
- General identity-file editing is not added in this slice.

## Overview

Overview is an operational command center, not a second task manager or chat
list.

### Live state

Show presence, runtime/harness, configured model, active-session count, memory
freshness, and the dashboard timestamp. Presence always has a text label; color
is supplemental.

### Now

Show the best truthful current-work summary:

1. a running session owned by the Familiar;
2. otherwise an active assigned task with an imperative next step;
3. otherwise an explicit idle state.

The card links to the owning chat or task surface. It does not infer work from
mere recency.

### Assigned work

Show a bounded list of active cards assigned to the Familiar. Each row includes
status, priority, title, and blocker/next-step state when present. Blocked tasks
must preserve the orchestration-ready task contract: unresolved dependencies,
one primary blocker, and one imperative next step.

The full task workflow remains in Tasks. Selecting a row opens `TaskDetailView`.

### Sessions

Show active sessions first, followed by a bounded recent list. Generated runs
remain excluded using the existing `SessionRow.isGeneratedRun` semantics.
Selecting a session opens the existing chat.

### Attention

Show evidence-backed items that require action, such as:

- review-state assigned tasks;
- blocked assigned tasks;
- analytics heal requests;
- fired Familiar-scoped reminders.

Every item names its source and links to the surface that can resolve it.

### Familiar-scoped reminders

The Overview contains reminders whose `familiarId` matches the current
Familiar. The native `Reminder` DTO must add `familiarId` and any fields used by
the editor.

The hub supports:

- create with title, optional note, and date/time;
- edit the same fields;
- mark done, dismiss, snooze, and delete;
- a locked Familiar association that the modal displays but cannot change.

The existing inbox mutation routes remain desktop-local. Native mutations use a
narrow, authenticated Familiar-reminder boundary:

```text
POST   /api/familiars/{id}/reminders
PATCH  /api/familiars/{id}/reminders/{reminderId}
POST   /api/familiars/{id}/reminders/{reminderId}/action
DELETE /api/familiars/{id}/reminders/{reminderId}
```

The create route forces `kind: "reminder"` and `familiarId` from the path. The
edit, action, and delete routes first verify that the target is a reminder and
already belongs to the path Familiar. They cannot reassign it or mutate
non-reminder inbox items. Allowed edit fields are title, body, and fire time.
Allowed actions are done, dismiss, and snooze with a bounded minutes value.
These routes use the established authenticated mobile/sidecar boundary without
changing `isLocalOrigin` or broadening general inbox write access.

Existing recurrence values are preserved when editing, but recurrence
authoring is deferred.

Global reminder entry points and the Tasks reminder surface remain available.

## Analytics

Analytics is a native digest derived from existing evidence. It does not
promise web feature parity.

### Activity

- trailing 14 calendar days of session counts;
- active and total session counts;
- last active timestamp;
- generated runs excluded consistently.

### Confidence

- a named confidence band, not a naked score;
- sample count;
- latest-report timestamp;
- explicit insufficient-data state.

The underlying scalar may remain part of the internal derivation, but the UI
must not present it as an independently validated quality score.

### Signal trends

- at most 100 persisted metric snapshots from the trailing 30 days;
- direction and magnitude only where the sample supports comparison;
- period and sample count shown with the result.

### Memory

- memory availability and freshness;
- memory count where available;
- recall and file-locatability signals from persisted reports;
- unavailable is distinct from zero.

### Capabilities

- most-used capabilities across the latest 30 reports;
- repeatedly lacking capabilities;
- capabilities marked vital;
- sample count and period.

### Attention and healing

- contract gaps;
- growth or configuration heal requests;
- feedback regressions when grounded by sufficient samples.

Each card includes a short definition, data period, freshness, and source.
Cards may expand or open a focused native detail sheet. Dense ledgers and
sortable tables remain on the web.

## iOS state and refresh behavior

Add a focused observable dashboard store owned by the hub:

```text
FamiliarDashboardStore
├── snapshotsByFamiliarId
├── loadingByFamiliarId
├── errorsByFamiliarId
├── refresh(familiarId:)
└── startVisibleRefresh(familiarId:)
```

Behavior:

1. Load immediately when the hub appears.
2. Support SwiftUI `.refreshable`.
3. Refresh every 30 seconds only while:
   - the hub is visible;
   - the scene is active; and
   - the connection is configured.
4. Cancel the previous request when the Familiar changes.
5. Deduplicate overlapping timer and pull-to-refresh requests.
6. Key all snapshots and mutations by Familiar ID.
7. Merge successful sections independently.
8. Keep a failed section's last-known-good value in memory and mark it stale.
9. Do not persist dashboard snapshots to disk in this release.

The store publishes a whole new snapshot on the main actor after decoding and
merging. Expensive derivation remains on the server.

## Loading, empty, and failure states

- Initial full load uses a stable skeleton matching the header and active tab.
- A total initial failure uses a full retryable error state.
- Section failure with no prior value uses an inline retryable error state.
- Refresh failure with prior value keeps content and shows a quiet stale label.
- Empty states explain the next action:
  - no tasks: open Tasks to assign work;
  - no sessions: start a chat;
  - no reminders: create a reminder;
  - insufficient analytics: complete more sessions before a trend is claimed.
- A missing Familiar produces a not-found state and returns to the roster.

Error copy is specific and non-blaming. Raw server errors are not rendered.

## Accessibility and visual behavior

The hub follows `docs/coven-design-language.md` and the native theme bridge:

- one accent-filled primary action per surface;
- semantic surface, text, border, and state colors only;
- presence color paired with text;
- minimum 44-point interactive targets;
- Dynamic Type without clipped metric labels;
- VoiceOver labels that combine metric name, value, period, and freshness;
- tab selection exposed as selected state;
- logical reading order independent of the visual card grid;
- reduced-motion behavior for refresh and chart transitions;
- charts never use color as their only channel;
- no hover-only or tooltip-only information.

On compact widths, Overview is primarily one column with two-column summary
stats only where Dynamic Type allows it. Analytics charts and cards use
horizontal space opportunistically on iPad without changing content order.

## Privacy and security

- Dashboard requests use the existing authenticated `CaveClient`.
- Access tokens never appear in dashboard DTOs, logs, analytics, or errors.
- Request/response logging must not include task titles, session titles,
  reminder text, profile biography, or analytics evidence.
- No new on-device persistent cache is introduced.
- Avatar credential transport remains owned by `cave-nv1dk`.
- Existing local-origin restrictions on general inbox mutations are preserved.
  Mobile reminder writes use only the path-scoped Familiar-reminder routes,
  which cannot mutate other inbox kinds or move a reminder between Familiars.

## Testing

### Server and shared model

- pure Overview selection and ordering;
- generated-session exclusion;
- blocked-task contract preservation;
- reminder scoping by Familiar ID;
- activity windows and calendar boundaries;
- confidence, trend, memory, capability, and heal-request definitions;
- unavailable versus zero semantics;
- stable issue-code redaction.

### API

- valid, invalid, and unknown Familiar IDs;
- authenticated access;
- full success;
- each source failing independently;
- multiple partial failures;
- deterministic `fresh`, `partial`, `empty`, and `unavailable` states;
- no safe snapshot available;
- 128 KiB response budget and every documented row/sample cap;
- response schema/version contract.

### Swift

- dashboard response decoding, including partial and future-compatible fields;
- per-Familiar snapshot isolation;
- Familiar switch cancellation;
- refresh deduplication;
- scene visibility pausing;
- last-known-good merge behavior;
- stale, empty, unavailable, and retry states;
- reminder `familiarId` decode and locked mutation payload;
- navigation from roster, cards, tasks, sessions, and Chat;
- Profile control wiring;
- analytics definitions, sample counts, and accessibility values.

### Native verification

- Xcode unit tests;
- focused UI tests for the three tabs and reminder modal;
- Dynamic Type and VoiceOver pass;
- reduced-motion pass;
- iPhone and iPad layouts;
- authenticated real-host smoke;
- local native build.

Source-contract tests may temporarily pin critical Swift behavior where CI
cannot compile the app. `cave-kwv57` remains the tracked route to a real Swift
CI build and should replace source-text coverage when it lands.

## Delivery sequence

After the written spec is reviewed, create dependency-ordered child Beads:

1. **Dashboard contract and model**
   - pure DTO/builders, server loaders, route, and contract tests.
2. **Native hub shell**
   - client DTO, store, roster navigation, header, tabs, loading/error states.
3. **Overview and reminders**
   - live state, Now, tasks, sessions, attention, reminder CRUD and scoping.
4. **Profile**
   - complete native profile presentation and existing model/access controls.
5. **Analytics digest**
   - evidence-backed cards, trends, detail sheets, and definitions.
6. **Avatar edit integration**
   - blocked on `cave-nv1dk`; expose mutation UI only after its contract lands.
7. **Accessibility, performance, and native verification**
   - final cross-tab audit, device verification, and regression coverage.

The dashboard contract blocks the native tabs. The hub shell blocks Overview,
Profile, and Analytics UI work. Avatar integration depends on both Profile and
`cave-nv1dk`. Final verification depends on all preceding children.

Coordinate shell changes with the active native redesign work under
`cave-4bsu`; this design adds one destination and must not independently
restructure the global drawer or app shell.

## Completion criteria

The program is complete when:

- a Familiar selected from the roster opens the unified native hub;
- Overview, Profile, and Analytics expose the approved contents and states;
- the shared dashboard contract returns truthful partial snapshots;
- reminders are scoped and editable without changing their Familiar;
- profile controls reuse existing authoritative mutation paths;
- avatar editing appears only after the avatar-sync dependency lands;
- refresh, stale, empty, unavailable, and not-found behavior is verified;
- accessibility, privacy, performance, tests, and native builds pass; and
- the goal's dashboard, profile, analytics, synchronization, and quality
  acceptance outcomes are updated with evidence.
