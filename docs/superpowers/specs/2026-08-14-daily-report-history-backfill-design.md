# Daily Report History Backfill

**Status:** Approved design; awaiting written-spec review

**Bead:** `cave-qphen`

**Date:** 2026-08-14

## Summary

Cave will make Daily Report a first-class destination and let the signed-in
GitHub user backfill a continuous report history from a selected calendar week
through today.

The workflow uses one server-owned batch operation. The browser selects a start
week but never supplies a GitHub login, sessions, board facts, or report
content. The server resolves the authenticated GitHub identity, loads reusable
local facts once, processes local calendar days in order, and upserts one
durable report per day. A fully observed day with no activity is persisted as an
explicit "Nothing to report" report; a day whose required facts are unavailable
is marked incomplete rather than misrepresented as quiet.

The range is capped at 52 calendar weeks. Existing reports are refreshed
idempotently. Progress is streamed to the dialog, and failed or incomplete days
can be retried without rebuilding successful dates.

## Problem

Daily reports already support one date at
`/daily-report/[date]`, use stable `daily-summary:YYYY-MM-DD` auto keys, and can
refresh an existing report in place. However:

- Daily Report is reached indirectly instead of being a persistent global
  destination.
- Historical generation is one day at a time from the empty state.
- Empty days are skipped because `buildDailySummaryContent` returns `null`.
- The single-day browser path submits its current sessions rather than letting a
  server-owned batch load one consistent snapshot.
- GitHub identity resolution and merged-PR collection are embedded in the
  per-day helper, making a bounded range operation unnecessarily repetitive.
- There is no progress, aggregate result, or targeted retry contract for a
  historical run.

The implementation seams are
`src/app/api/inbox/daily-summary/route.ts`,
`src/lib/daily-summary-notifications.ts`,
`src/lib/server/github-merged.ts`,
`src/app/api/sessions/list/route.ts`,
`src/app/daily-report/[date]/page.tsx`,
`src/components/daily-report-day.tsx`,
`src/components/dashboard/bento-dashboard.tsx`,
`src/components/sidebar-minimal.tsx`,
`src/components/analytics-page-shell.tsx`, and the shared navigation modules.

## Goals

- Backfill every local calendar day from a user-selected ISO week through
  today, inclusive.
- Resolve the GitHub actor from the installed credential on the server; never
  accept a client-supplied login.
- Persist quiet days explicitly when all required sources prove the day was
  quiet.
- Refresh existing daily reports without creating duplicate inbox items.
- Keep incomplete source data distinguishable from a truthful zero.
- Show live per-day progress and useful aggregate counts.
- Retry only failed or incomplete dates from the completed run.
- Make today's Daily Report prominent in both global navigation and the
  Dashboard.
- Preserve the existing automatic current-day behavior and single-day report
  URLs.

## Non-goals

- Scheduling recurring historical backfills.
- A durable queue or resumable background-job system.
- Ranges longer than 52 calendar weeks.
- Selecting another GitHub user, organization, repository, familiar, or
  timezone.
- Rewriting report presentation, narratives, sharing, week navigation, or
  inbox storage.
- Generating a familiar-written narrative for every historical day. Backfill
  persists factual reports; narrative generation remains an independent layer.
- Making ordinary automatic refreshes persist quiet days.

## User experience

### Entry points

Daily Report appears as a persistent **Daily report** row in the Home section of
the global siderail. It links directly to
`/daily-report/<today-in-local-time>` rather than introducing a new workspace
mode. Both shell implementations must expose the same destination:

- `SidebarMinimal` in the main workspace.
- `AnalyticsPageShell` on standalone routes, including the report itself.

The row uses one shared destination descriptor so label, icon, URL, ordering,
tooltip, and active state cannot drift between shells. On any
`/daily-report/*` route it receives `aria-current="page"`.

The Dashboard renders a prominent **View daily report** action in its top area.
The action lives in the shared `BentoDashboard` content so it appears in both
the standalone `/dashboard` route and the embedded Dashboard surface. It opens
today's local-date report even when the report has not yet been generated; the
existing empty state remains the recovery surface.

### Backfill history dialog

The Daily Report chrome gains a secondary **Backfill history** action beside
Refresh and Share. It opens the shared `Modal` primitive with:

- breadcrumb: `Daily report › Backfill history`;
- the authenticated GitHub login and avatar as read-only identity;
- a native week input whose value is `YYYY-Www`;
- an inclusive range label, for example `Jul 6–Aug 14`;
- the derived count of calendar weeks and days;
- a primary action labeled **Backfill X weeks**.

The current ISO week counts as one week. Selecting `2026-W33` starts at local
midnight on that ISO week's Monday and ends at the current local day. The
earliest valid selection is the Monday 51 weeks before the current ISO week, so
the inclusive range never exceeds 52 weeks. Future weeks and malformed week
values are rejected in both client and server validation.

The dialog preflights the authenticated identity when it opens. If Cave has no
usable GitHub credential, the primary action stays disabled and the dialog
links to GitHub settings. A transient identity lookup failure is an error with a
Retry action, not an invitation to type a username.

### Progress and completion

While running, backdrop and Escape dismissal are disabled, the focus trap
remains active, and the primary action becomes a non-clickable progress state.
The dialog shows:

- `N of M days`;
- the date currently being processed;
- created, refreshed, quiet, incomplete, and failed counts;
- a determinate progress bar.

Each completed day updates the counters immediately. The dialog announces
milestones through `useAnnouncer()` without announcing every render. Closing the
route or unmounting the dialog aborts the request; the server stops before the
next day, while already committed reports remain valid.

At completion:

- a clean run offers **View oldest report** and **Done**;
- a partial run lists the failed or incomplete dates with concise reasons and
  offers **Retry failed days**;
- retry processes only the listed dates and merges its outcomes into the
  existing result view.

## Calendar and range contract

Range calculations live in one pure server-safe module and are reused by the
dialog for display:

```ts
type BackfillRange = {
  startWeek: string; // ISO week, YYYY-Www
  startDate: string; // local date slug, YYYY-MM-DD
  endDate: string;   // today's local date slug
  weekCount: number; // inclusive ISO weeks
  dayCount: number;  // inclusive local calendar days
  dates: string[];   // ascending local date slugs
};
```

The helper constructs dates with local calendar components and advances with
`setDate`, not fixed 24-hour millisecond offsets, so daylight-saving changes do
not skip or duplicate a local day. The server recomputes the range from
`startWeek`; client-supplied counts and date boundaries are never trusted.

## API contract

`GET /api/inbox/daily-summary/backfill` performs a non-mutating preflight and
returns:

```ts
type BackfillPreflight = {
  ok: true;
  identity: {
    login: string;
    avatarUrl: string | null;
  };
  currentWeek: string;
  earliestStartWeek: string;
};
```

Identity comes from `resolveGitHubToken()` plus GitHub's authenticated `/user`
endpoint. A configured username without an authenticated credential is not
enough for this user-scoped mutation. Missing credentials return `401`;
unreachable or rejected GitHub identity lookups return a specific `502` or
`503`.

`POST /api/inbox/daily-summary/backfill` accepts one of two strict request
shapes:

```ts
type BackfillRequest =
  | { mode: "range"; startWeek: string }
  | { mode: "retry"; dates: string[] };
```

`mode: "range"` is the normal workflow and accepts only the chosen start week;
the server derives every date. For `mode: "retry"`, the client builds `dates`
only from the failed, incomplete, or interrupted outcomes in its current result
view. The server does not trust that provenance: it independently validates that
every retry date is unique, not future, and within the rolling 52-week window
ending today. The retry list is capped at 364 entries.

The route requires `isLocalOrigin(req)` like the existing daily-summary route.
It returns newline-delimited JSON (`application/x-ndjson`) so one request can
report progress without introducing a background-job store:

```ts
type BackfillEvent =
  | {
      type: "started";
      identity: { login: string; avatarUrl: string | null };
      range: BackfillRange;
    }
  | {
      type: "day";
      completed: number;
      total: number;
      outcome: BackfillDayOutcome;
      counts: BackfillCounts;
    }
  | {
      type: "complete";
      outcomes: BackfillDayOutcome[];
      counts: BackfillCounts;
    }
  | {
      type: "fatal";
      code: string;
      message: string;
    };

type BackfillDayOutcome = {
  date: string;
  status:
    | "created"
    | "refreshed"
    | "quiet-created"
    | "quiet-refreshed"
    | "incomplete"
    | "failed";
  itemId?: string;
  missingSources?: Array<"sessions" | "github" | "board">;
  message?: string;
};

type BackfillCounts = {
  completed: number;
  created: number;
  refreshed: number;
  quiet: number;
  incomplete: number;
  failed: number;
};
```

Validation and identity failures occur before the stream starts and use normal
JSON error responses. Once streaming starts, an unrecoverable batch-level
failure is a `fatal` event. A single date failure always becomes a `day` event
and does not stop later dates.

## Server architecture

### Shared daily-report service

The route handler must not call the existing route handler. Extract a
server-only service that owns one day's facts-to-inbox upsert:

```ts
type UpsertDailyReportInput = {
  date: Date;
  sessions: SessionRow[];
  sourceState: DailyReportSourceState;
  githubPrs?: MergedPr[];
  cardsCompleted?: CompletedCard[];
  persistQuiet: boolean;
  narrative?: NarrativePatch | null;
};
```

The current `POST /api/inbox/daily-summary` delegates to this service with
`persistQuiet: false`; the batch route uses `persistQuiet: true`. This preserves
automatic current-day behavior while removing duplicated lock, auto-key,
timestamp, media, broadcast, and refresh logic.

The service acquires `withInboxLock` for one date at a time. It never holds the
lock while loading sessions, querying GitHub, loading the board, or processing
the complete range. This keeps unrelated inbox writes responsive and lets each
successful date commit independently.

Existing `daily-summary:<date>` items are refreshed in place, retaining their
IDs and any valid stored narrative unless a new narrative was explicitly
provided. Missing items are created once. Every successful mutation broadcasts
the existing created or updated inbox event.

### Reusable source snapshots

Before processing days, the batch route:

1. Resolves the authenticated GitHub user.
2. Loads the enriched, unscoped session list once through an extracted
   server-side session-list function shared with `/api/sessions/list`.
3. Loads the Board once.
4. Fetches authored merged PRs for the selected date range in bounded calendar
   windows, then groups them by local date.
5. Loads the inbox inside each per-day lock so concurrent reminder and inbox
   writes are not overwritten.

GitHub range collection carries completeness per date. Requests use the
authenticated login, local-day boundary filtering, bounded pagination, and
small fixed concurrency. If a window exceeds GitHub's searchable result limit,
the collector subdivides it until the affected dates are complete or a
single-day limit is reached. A rate limit, network failure, malformed response,
or irreducibly truncated day marks affected dates incomplete.

The existing per-day `fetchMergedPrsForDay` may delegate to the same identity
and range primitives, preserving its cache behavior for ordinary report
refreshes.

### Quiet reports and source completeness

`buildDailySummaryContent` gains an explicit empty-day mode rather than changing
its default:

```ts
type EmptyDayBehavior = "skip" | "persist";
```

With `"persist"`, a day whose known activity counts are all zero produces a
normal daily-summary item with:

- body: `Nothing to report.`;
- zero-valued structured stats;
- empty structured PR, completed-card, and session collections;
- the normal auto key and report URL;
- a report completeness marker showing every required source was observed.

A report may be persisted as partial when at least one known source has real
activity but another source is unavailable. Its missing section remains absent
and the day outcome is `incomplete`.

A day with no known activity and any unavailable required source is not
persisted as quiet, because Cave cannot truthfully claim that nothing happened.
It returns `incomplete` and is eligible for retry. This is the key distinction
between zero and unknown.

## Idempotency and failure behavior

- The stable daily auto key is the idempotency boundary.
- Repeating a completed range refreshes matching items; it never appends
  duplicates.
- A quiet rerun refreshes the same quiet item.
- A previously partial report becomes complete in place when the missing source
  recovers.
- A previously quiet report becomes an activity report in place if later facts
  reveal activity.
- GitHub, Board, or session-source failures are recorded for the affected day;
  unavailable data is never coerced to an empty array.
- A save failure affects only that day. Later dates continue.
- Request cancellation is checked between source windows and before each day's
  upsert. No in-flight inbox write is interrupted midway.
- Malformed streamed events or a dropped connection are surfaced as an
  interrupted run. The client retains received outcomes and can retry dates that
  lack a terminal outcome.

## Accessibility and design-system requirements

- Use the shared `Modal`; do not build a new dialog shell.
- Keep the focus trap active for the dialog's entire lifetime and return focus
  to the **Backfill history** trigger on close.
- Disable backdrop and Escape dismissal during mutation without releasing the
  trap.
- Every interactive control uses `.focus-ring` or the matching shared
  primitive.
- The progress element has an accessible name and numeric `aria-valuenow`,
  `aria-valuemin`, and `aria-valuemax`.
- Progress, completion, cancellation, and retry results are announced through
  the shared live-region hook. Counter colors are supplementary; text and icons
  carry status.
- Busy controls expose `aria-busy` and disabled semantics.
- Source failures use the shared danger presentation and a concrete retry
  action.
- Motion uses existing duration/easing tokens and becomes static under
  `prefers-reduced-motion`.
- New CSS uses semantic tokens, the 4px spacing grid, approved type sizes and
  radii, and survives all theme/mode combinations.
- Copy remains plain and specific: `Backfill history`, `Backfill X weeks`,
  `Retry failed days`, `Nothing to report.`, and `Couldn't reach GitHub`.

## Testing

### Pure range and source tests

- Parse valid ISO weeks, including week 53.
- Reject malformed, future, and over-52-week selections.
- Derive inclusive week/day counts for current-week and 52-week ranges.
- Preserve one local date per iteration across daylight-saving transitions.
- Validate retry lists for uniqueness, bounds, future dates, and maximum size.
- Group merged PRs into the correct local day at UTC boundary offsets.
- Distinguish complete zero facts from unavailable sources.

### Service and API tests

- Resolve the actor from authenticated `/user`, never a request login.
- Return actionable preflight errors for missing, rejected, and unreachable
  credentials.
- Load sessions and Board once per range.
- Stream `started`, ordered `day`, and `complete` events.
- Create missing activity reports and refresh existing reports.
- Persist complete quiet days with `Nothing to report.`.
- Refuse to label an unknown day quiet.
- Preserve item IDs and narratives on rerun.
- Upgrade partial and quiet reports in place when later facts change.
- Continue after one day fails and aggregate counts accurately.
- Abort before the next date when the request signal is cancelled.
- Retry only the supplied failed/incomplete dates.
- Keep the original daily-summary route's future-date and midnight-rollover
  guards.

### Component tests

- The workspace rail and standalone rail both link to today's report and expose
  active-page semantics.
- Both Dashboard render paths show **View daily report**.
- The dialog displays the authenticated identity and has no editable user
  field.
- Start-week changes update exact range, week count, day count, and CTA copy.
- Invalid or unauthenticated states disable submission with specific guidance.
- Streamed events update progress and aggregate counters.
- Partial completion lists dates and enables targeted retry.
- The dialog traps focus, returns focus, blocks dismissal while busy, and emits
  live announcements.
- Unmount aborts the request without applying stale state updates.

### Daemon-less Playwright

Route-mock identity, sessions, Board, inbox, and the NDJSON backfill stream.
Dismiss onboarding, open Daily Report from the siderail, choose a start week,
run the backfill through activity and quiet dates, verify progress, and navigate
to the persisted oldest report. A second scenario injects one incomplete day,
uses **Retry failed days**, and verifies that successful dates are not sent
again.

## Acceptance criteria

1. Daily Report is directly reachable from both global siderails and the
   Dashboard's prominent action.
2. The dialog identifies the authenticated GitHub user without accepting a
   client-selected identity.
3. A valid start week backfills every local date through today within a
   52-week maximum.
4. Existing reports refresh in place and missing reports are created with no
   duplicate auto keys.
5. Fully observed quiet days persist as explicit `Nothing to report.` reports.
6. Unavailable sources produce incomplete outcomes, never fabricated zeros.
7. The dialog presents live progress, aggregate results, cancellation-safe
   behavior, and targeted retry.
8. Focus, announcements, reduced motion, semantic status, and theme safety meet
   the Cave design-system contract.
9. Targeted unit, component, API, and daemon-less browser tests cover the
   approved range, identity, idempotency, quiet-day, failure, retry, and
   accessibility behavior.
