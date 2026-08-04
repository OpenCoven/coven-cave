# Global intelligent search and structured filtering design

Status: design direction approved; written-spec review pending
Bead: `cave-ychtl`

## Problem

Cave has a persistent top search control and a capable command palette, but
search remains split across unrelated implementations. The palette searches
familiars, sessions, tasks, memories, settings, projects, commands, and chat
content with separate client-side corpora. Chat rails, Tasks, Familiars,
Projects, Settings, and the project file browser each add another search input
or shortcut with different syntax, scope, ranking, and empty/error behavior.

The result is powerful but unpredictable. Current context is mostly implicit,
`@familiar` is the only structured scope, file content uses a separate API,
active filters cannot be inspected or shared, and adding an entity requires
editing the palette rather than registering a search provider.

## Decision

Replace the current palette search and duplicate global search fields with one
command-style search surface anchored in the existing centered top chrome. It
opens with the current project, familiar, room, chat/session, and runtime as
visible hard-constraint chips. Users broaden by removing chips or pressing
Command/Control+Enter, without navigating to a separate search page.

The foundation uses a hybrid server-owned search coordinator:

- a local deterministic parser produces one versioned query AST;
- a provider registry normalizes every entity into shared document/result
  contracts;
- bounded entity corpora use a regenerable SQLite FTS5 index;
- project file bodies remain live through the existing permission-guarded
  ripgrep route and normalize into the same result stream;
- one deterministic ranker merges providers after permissions and hard filters
  are applied.

The alternatives are rejected deliberately:

- Indexing every repository body would make queries uniform, but duplicates
  potentially huge workspaces and introduces watcher, staleness, and access
  complexity before the interaction has proved itself.
- Federating existing endpoints directly from the client would minimize the
  first diff, but preserves the inconsistent ranking, filters, latency, and
  failure behavior this design exists to remove.
- A model-backed query parser would understand more language, but adds latency,
  privacy ambiguity, nondeterminism, and a new failure mode to a local control.

## Goals

- Provide one persistent search entry point on desktop and narrow layouts.
- Make default context visible, removable, keyboard-operable, and globalizable.
- Support forgiving free text, exact phrases, fuzzy matching, structured
  filters, and high-confidence natural-language equivalents.
- Return ranked, action-oriented results from projects, familiars, tasks,
  sessions/chats, and current-project files in the MVP.
- Preserve existing command, settings, and memory discovery during migration.
- Make filters and result providers declarative so later entity types do not
  require parser or search-UI rewrites.
- Preserve permissions at the provider and coordinator boundaries.
- Keep warm indexed search responsive in large local workspaces and make
  partial provider failure explicit.

## MVP boundary

The first release adds new normalized providers for:

- projects;
- familiars;
- tasks;
- sessions and searchable chat content;
- files within the current allowed project.

Compatibility providers preserve the palette's existing commands, workspace
destinations, settings entries, and memory rows while those corpora migrate to
the normalized index. No capability disappears merely because its permanent
provider is deferred.

The first filter registry includes:

- `type`;
- `status`;
- `project`;
- `familiar`;
- `room`;
- `runtime`;
- `source`;
- `has`;
- `after` and `before`;
- `tag`.

Providers declare which filters they support. A valid filter with no applicable
provider produces a truthful filtered-empty state; it never silently widens.

## Non-goals

- Do not add first-class indexed providers for skills, tools, external sources,
  runs, analytics, reports, artifacts, confidence/evaluation, or approval and
  access workflows in the MVP.
- Do not index all repository file bodies or add a cross-project file watcher.
- Do not add semantic embeddings, vector search, or model-backed query parsing.
- Do not create a standalone search page.
- Do not remove narrow controls that only filter already-rendered data and are
  honestly labeled `Filter <items>…`.
- Do not change the authoritative storage of any indexed entity. The search
  database is always derivative.

## Information architecture

The existing centered desktop menu-bar search remains the persistent location.
The mobile top bar represents the same state and opens the same surface. When
activated, the field grows into an anchored overlay beneath the top chrome
rather than opening a disconnected full-page destination.

The expanded surface contains:

1. The search field with implicit context chips, explicit filter chips, and
   remaining free text on one line.
2. A compact mode row with **Top results**, **Grouped**, result count/freshness,
   and **Copy search link**.
3. Action-oriented result rows with type, title, scope metadata, matching
   excerpt/reason, freshness/status, and a primary action.
4. A keyboard footer ending with the explicit global action.

The collapsed field shows the most specific useful scope and condenses overflow
to `+N scopes` at narrow widths. Expanding restores every chip. Scope is never
communicated by placeholder text alone.

Before typing, the overlay shows context-aware suggestions such as **Search in
Psyche Build**, **Filter blocked tasks**, **Find Cody's recent work**, **Show
files used in this chat**, and **Search all projects**. Suggestions are real
query-state mutations, not bespoke navigation.

## Query-state contract

The UI, URL serializer, API, and tests share one versioned state shape:

```ts
type SearchQueryState = {
  version: 1;
  text: string;
  phrases: string[];
  filters: SearchFilter[];
  scopes: SearchScope[];
  presentation: "top" | "grouped";
};

type SearchFilter = {
  key: string;
  operator: "is" | "has" | "after" | "before";
  value: string | boolean;
  origin: "syntax" | "natural-language" | "picker" | "context";
};

type SearchScope = {
  dimension: "project" | "familiar" | "room" | "session" | "runtime";
  id: string;
  label: string;
  implicit: boolean;
};
```

Navigation derives implicit scopes from the active workspace state. Filters
chosen by syntax, the picker, or deterministic language rules are explicit.
Command/Control+Enter removes only implicit scopes; explicit filters remain
active for the global query. After broadening, former-context matches receive a
small rank boost but do not exclude broader matches.

Typing remains transient and does not modify browser history. **Copy search
link** and result navigation serialize canonical, ordered query parameters.
Opening a shared link restores the same chips, free text, and presentation.
Unknown future query versions fail closed to plain text rather than applying
misinterpreted filters.

## Filter registry and parser

A declarative filter registry owns each key's aliases, value kind,
completions, entity applicability, chip label, and URL representation. Adding a
new status or entity type updates registry data and providers; the React search
surface does not gain another parsing branch.

The parser accepts:

- unquoted free text;
- quoted exact phrases;
- `key:value` filters;
- quoted filter values such as `room:"code workshop"`;
- repeated filters where the registry permits multiple values;
- incomplete tokens used for suggestions.

Recognized completed tokens become visible editable chips. Unknown keys,
unknown values, unmatched quotes, and incomplete tokens remain searchable text
and receive suggestions. Search never fails because a user typed a colon.

Deterministic natural-language rules run after lexical parsing and only consume
high-confidence phrases. Initial rules cover:

- entity and status: `blocked tasks`, `failed sessions`;
- familiar and project: `for Cody`, `in Psyche Build`;
- signals: `with errors`, `needs a decision`;
- relative dates: `today`, `yesterday`, `last week`, `last 7 days`.

For example, `show blocked tasks for Cody` produces visible `type:task`,
`status:blocked`, and `familiar:Cody` chips. Ambiguous language remains in
`text`; there is no low-confidence hidden interpretation.

## Normalized document and provider contracts

Every indexed or live provider emits the same searchable document shape:

```ts
type SearchDocument = {
  id: string;
  providerId: string;
  entityType: string;
  title: string;
  body: string;
  excerpt: string;
  projectId: string | null;
  projectRoot: string | null;
  familiarId: string | null;
  roomId: string | null;
  sessionId: string | null;
  runtime: string | null;
  status: string | null;
  tags: string[];
  createdAt: string | null;
  updatedAt: string | null;
  sourceType: string;
  permissions: SearchPermission[];
  sourceVersion: string;
  action: SearchAction;
  secondaryActions: SearchAction[];
};
```

`providerId + id` is the stable index identity. `sourceVersion` is a provider-
owned fingerprint such as an mtime, store revision, or content digest.
Providers implement collection/fingerprinting, normalization, supported
filters, permission evaluation, and action construction. The coordinator owns
query execution and ranking; providers do not return pre-ranked UI rows.

The result contract adds match reasons, normalized score components, highlights,
provider freshness, and safe diagnostics without exposing raw storage paths or
permission data that the active requester cannot inspect.

## Indexing and data flow

The derivative index lives under Cave's local state as a mode-0600 SQLite file,
separate from the daemon database. The search store refuses symlinked database
paths, uses transactions for provider refreshes, and may be deleted and rebuilt
without losing user data. It is excluded from backup/export payloads.

SQLite stores filterable metadata in ordinary columns and title/body/tag text
in an FTS5 virtual table. Provider refreshes upsert changed documents and
remove documents no longer present. A provider fingerprint avoids scanning an
unchanged source; a failed refresh keeps the last verified snapshot and marks
it stale.

The request path is:

1. The client parses and displays query state immediately.
2. `POST /api/search` validates the versioned AST, request limits, and context.
3. The coordinator selects applicable providers and enforces hard scopes.
4. Indexed providers query FTS5 plus metadata filters.
5. The file provider invokes the existing permission-guarded project ripgrep
   boundary only when an allowed project scope exists.
6. Provider results normalize, permission-filter, rank, deduplicate, and return
   as one page with group/facet counts and diagnostics.
7. A live provider may append a later page only if its request id still matches
   the current query.

Cold search may return completed provider results with `indexState: "warming"`
and then refresh once indexing finishes. A loading provider never blocks valid
results from another provider.

## Ranking

Ranking is deterministic and exposes a reason suitable for tests and UI
explanation. The order of evidence is:

1. exact normalized title;
2. exact quoted phrase;
3. title prefix and token match;
4. bounded fuzzy title match;
5. FTS relevance across title, body, and tags;
6. recency and actionable status;
7. former-current-context boost after explicit global broadening.

Hard scopes and structured filters run before scoring. Exact title matches do
not lose to newer body-only matches. Provider scores are normalized before
merging so a provider cannot dominate merely because its native score uses a
larger numeric range.

Top mode interleaves the best normalized results while enforcing a small
per-type diversity floor. Grouped mode uses the same scores and rows, partitioned
by entity type; switching views does not issue a semantically different query.

## Result actions

Every result has one primary action and may expose allowlisted secondary
actions. Enter executes the primary action. The MVP includes:

- project: open the project and its chats;
- familiar: open/switch to the familiar;
- task: open the task inspector;
- session/chat: open the chat at the best matching message;
- file: open the existing project file preview at the match.

Rows explain why they matched and show enough context to act without opening:
project, familiar, state, relative time, match count, excerpt, or blocker
reason where available. Static metadata remains muted text; pills are reserved
for active filters and live state.

## Keyboard and accessibility

- Command/Control+K focuses and expands global search from anywhere Cave owns
  the shortcut.
- Up/Down moves through results.
- Enter executes the selected result's primary action.
- Tab moves through filter and completion suggestions without trapping focus.
- Backspace removes the final chip when free text is empty.
- Escape closes a nested picker first, then closes the expanded search while
  preserving its state in the persistent bar.
- Command/Control+Enter removes implicit context scopes and searches globally.

The expanded surface remains a modal combobox/listbox interaction with a focus
trap, visible active descendant, focus return, and live result-count updates.
Chips expose remove buttons with specific accessible names. Provider failures
use alerts; warming and result summaries use status announcements. Color never
carries status alone, and no new motion is required beyond existing modal
transitions and reduced-motion behavior.

## Migration of fragmented search

The existing command palette becomes the new search surface rather than being
replaced by a second overlay. Existing intent handling and launcher commands
move behind normalized result actions.

Duplicate search inputs are handled by semantics:

- Chat/sidebar search shortcuts focus global search with `type:chat` and the
  applicable context chips.
- Tasks search shortcuts focus global search with `type:task`.
- Project file search focuses global search with `type:file` and the current
  project scope.
- Familiar collection search focuses global search with `type:familiar`.
- A control that only narrows an already-rendered collection may remain, but it
  uses the canonical `Filter <items>…` copy and does not claim global scope.

The migration is relocation, not removal. Existing commands, settings search,
memories, recent searches, and role-surface navigation stay reachable through
compatibility providers until permanent adapters replace them.

## Error handling and freshness

`POST /api/search` returns normalized results, groups/facets, cursor state,
index freshness, and per-provider diagnostics. It distinguishes:

- no matches;
- a filter with no applicable matches;
- an index still warming;
- stale results from a failed refresh;
- a provider that could not be searched;
- permission-denied scope.

Provider failure returns partial results with specific copy such as **Couldn't
search files — Retry**. It never becomes a convincing empty result set.
Requests are debounced, abortable, size-capped, timeout-bounded, and cursor-
paginated. The client associates every response with a request id so stale
responses cannot replace newer text.

A corrupt or incompatible index is quarantined and rebuilt from authoritative
sources. Rebuild status is visible, and search remains available from providers
that do not depend on the index.

## Performance targets

- Warm indexed search returns its first result page within 150 ms on the local
  desktop target.
- Current-project file results target 500 ms locally and may arrive after
  indexed results.
- The first response is capped at 50 results with provider/type budgets;
  additional results use cursors.
- Fuzzy matching operates only on a bounded candidate set after exact/prefix
  and FTS retrieval.
- Heavy search UI and indexing modules remain lazy so the root shell stays
  inside existing JavaScript and CSS budgets.

These are product targets measured by tests/diagnostics, not promises that hide
slow or failed providers.

## Security and permissions

- Each provider applies its existing access checks before returning documents.
- The coordinator applies active familiar/project permissions again before
  ranking and serialization.
- Project files continue through `resolveAllowedProjectPath`, daemon session
  roots, project permission checks, argument-array execution, `.env` exclusion,
  and git-visible-file boundaries.
- Query text is bounded and never interpolated into a shell command.
- Search diagnostics expose provider ids and safe error categories, not secret
  values, disallowed paths, or hidden result counts.
- The derivative index is local, private, non-exported, and contains no unique
  state.

## Testing and verification

Implementation follows red-green TDD with these contract layers:

- parser tables for quoted syntax, incomplete/unknown filters, repeated values,
  deterministic natural-language rules, and ambiguous-language preservation;
- canonical URL serialization/restore and query-version fallback;
- filter-registry tests proving new types/statuses remain data additions;
- provider contract fixtures for normalization, fingerprints, deletions,
  supported filters, actions, and safe diagnostics;
- SQLite migration, incremental refresh, stale snapshot, corruption rebuild,
  and permission-filter tests;
- file-provider tests retaining every existing project-search security guard;
- deterministic ranking golden tests, including exact-title precedence,
  provider normalization, diversity, and post-global context boost;
- API tests for caps, abort/timeout behavior, cursors, partial failures,
  filtered-empty states, and permission leakage;
- React tests for chips, completions, filter picker, Top/Grouped parity, result
  actions, announcements, and focus return;
- keyboard tests for Command/Control+K, arrows, Enter, Tab, Backspace, Escape,
  and Command/Control+Enter;
- end-to-end tests for chat/project/familiar default contexts, explicit global
  broadening, shared-link restoration, and duplicate-search relocation;
- performance fixtures representing large task/session corpora and a bounded
  current-project file search.

Before delivery, run focused tests, tests-wired, typecheck, lint/design gates,
the relevant app/API suites, build and bundle budgets, and `git diff --check`.
Verify the rendered search in the native Tauri shell at desktop and narrow pane
widths, in dark, light, and one non-default theme. Walk §9 of the Coven design
language and report any proof gap explicitly.

## Delivery sequence

The design is intentionally split into independently testable implementation
units:

1. Query/filter/URL contracts and deterministic parser.
2. Normalized document/result/provider contracts and SQLite store.
3. Project, familiar, task, session/chat, and live file providers.
4. Search coordinator and `/api/search` contract.
5. Persistent top-chrome interaction and normalized results.
6. Context integration, keyboard behavior, URL sharing, and duplicate-search
   relocation.
7. Performance, accessibility, Tauri visual verification, and compatibility-
   provider cleanup.

Skills, tools, sources, runs, analytics, reports/artifacts, confidence, and
approval/access workflows become subsequent provider slices against the same
contracts.

## Delivery boundary

This document approves design only. Implementation starts only after the spec
review gate and a detailed implementation plan. The temporary docs-only
worktree was explicitly authorized because the managed lifecycle inventory was
at 20/12 worktrees with no cleanup-ready candidate; it must not be treated as
authority to bypass managed lifecycle for product code.
