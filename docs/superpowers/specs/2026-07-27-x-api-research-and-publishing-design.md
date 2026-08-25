# X API research and familiar publishing

## Status

The MVP direction is approved. This written specification is awaiting
maintainer review and does not authorize implementation.

- Date: 2026-07-27
- Bead: `cave-8i8q5`
- Surfaces: Research Desk, Comms Operations, Familiar Studio

**Post-ship reconciliation (cave-uajyn, 2026-08-24).** An acceptance audit
(cave-1tu16) diffed the shipped publish path against this document and found
five divergences. Two were genuine gaps and are now fixed in code: the
confirmation view now uses the shared Modal and states the connected account
and "No location will be added.", and the confirmation token now expires ten
minutes after minting. Three are intentional departures this document is being
updated to describe rather than to fix, with reasoning inline at each site
below: the module/route surface (`### Modules`, `### Local API routes`), the
confirmation token's shape (`### Approval and exact preview`), and the receipt
storing full post text rather than a `textSha256` (`### Idempotency and
receipts`). Full reasoning for all five is on the bead as a `bd note`.

## Objective

Let a user connect one X account to Coven Cave, save and use X posts as
familiar-scoped Research Desk sources, and publish a single text post from a
familiar's Comms Operations room after explicit human confirmation.

The integration must preserve the current room architecture, keep X credentials
out of browser storage and familiar subprocesses, and fail closed when account,
scope, billing, or post state is uncertain.

## Success criteria

- Coven Cave connects an X account through OAuth 2.0 Authorization Code with
  PKCE without requiring a production user to create an X developer app.
- A user explicitly grants each familiar research and publishing capabilities;
  both default to disabled.
- Research Desk can grab one X post URL or run one bounded recent search, save a
  durable source reference, and attach it to a selected research mission.
- Mission runs hydrate attached X posts just in time and remove the temporary
  content after the run.
- Comms Operations can draft, approve, preview, and publish one text-only X
  post. The server publishes exactly the text shown in the confirmation view.
- Successful publishing records the returned post ID and URL. An ambiguous
  network result is never retried automatically.
- Tokens, raw X responses, and post text do not leak into logs, familiar
  process environments, durable source ledgers, or publish receipts.
- The integration follows the Coven design language, survives all theme/mode
  combinations, and passes API, app, accessibility, and native desktop checks.

## Scope

### Included

- One OpenCoven-owned X application for production.
- One connected X account at a time.
- OAuth 2.0 PKCE connection, refresh, scope upgrade, and disconnect.
- X post URL lookup.
- Recent X post search, capped at 10 results per explicit request.
- Per-familiar saved source references and mission attachment.
- Temporary mission-time source hydration.
- One text-only post per explicit publish confirmation.
- Durable success, failure, and uncertain publish receipts.

### Excluded

- Media, replies, quotes, threads, polls, location, and post deletion.
- Scheduling, bulk actions, automatic posting, or familiar-initiated writes.
- Inbox, direct messages, notifications, streaming, or background monitoring.
- Full-archive search or automatic pagination.
- Multiple connected account switching.
- Production bring-your-own X applications or client secrets.
- Browser automation and X Web Intents as a publishing substitute.
- Persisting a permanent raw copy of X post content.
- Adding X content to global search, vector indexes, memory, fine-tuning, or
  model-training datasets.

## Chosen approach

Use a server-mediated integration with three explicit boundaries:

```text
Familiar Studio
  └─ account status + per-familiar research/publish grants

Research Desk Resources
  └─ local API ── X read API
        ├─ durable source identity and user notes
        └─ short-lived normalized content cache
              └─ temporary mission runtime files

Comms Operations
  └─ exact preview token ── explicit confirmation ── X create-post API
                                               └─ durable receipt
```

The browser talks only to local Coven Cave routes. Those routes hold no client
secret, retrieve encrypted user tokens on the server, enforce familiar
capabilities, normalize X responses, and return only the fields the UI needs.
Familiar subprocesses receive temporary normalized source files for a requested
mission iteration, never credentials or a generic X tool.

This design uses the [X API](https://docs.x.com/x-api) rather than browser
automation. X Web Intents are not used because they cannot provide the
authoritative API result required for a durable publish receipt.

## Alternatives rejected

### Require every user to register an X application

Rejected for production. It makes first-run setup dependent on X developer
configuration and conflicts with X's
[developer policy](https://docs.x.com/developer-terms/policy) against requiring
each user to register their own application. A client-ID override remains
available for OpenCoven development and staging.

### Store complete X posts as permanent research snapshots

Rejected for the MVP. Permanent copies make edit and deletion compliance
dependent on polling or a compliance stream. The durable object is instead the
source identity, provenance, user notes, and mission links. Normalized content
is a bounded cache and is rehydrated for active work.

In this design, “saved snapshot” means a durable source record plus the latest
eligible short-lived normalized content. It does not mean an indefinite archive
of the X response.

### Give familiars a generic X tool

Rejected. It would widen the credential and action boundary, make user intent
harder to prove, and permit reads or writes outside the visible room workflow.
The MVP exposes only user-triggered Research Desk reads and confirmed Comms
Operations writes.

### Publish directly from the draft form

Rejected. Approval state alone does not prove that the user saw the final
payload. Publishing requires a server-generated exact preview followed by a
separate confirmation action.

## Account connection

### Application model

Production uses one OpenCoven-owned X application configured as a Native App.
Its public client ID is part of the application configuration; there is no
client secret in the desktop bundle.

`COVEN_CAVE_X_CLIENT_ID` may override the public client ID for development or
staging. It is not a production setup path exposed in the UI.

The external deployment prerequisite is:

- an OpenCoven X project and Native App;
- the exact loopback redirect URI registered in that app;
- X API access and
  [pay-per-use credits](https://docs.x.com/x-api/getting-started/pricing)
  sufficient for live verification.

### OAuth flow

The integration follows X's
[OAuth 2.0 Authorization Code flow with PKCE](https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code).

1. The user selects **Connect X** or **Reconnect for publishing**.
2. `POST /api/x/oauth/start` creates a high-entropy state value, PKCE verifier,
   and S256 challenge in server memory.
3. Coven Cave opens the system browser to X's authorization page.
4. X redirects to `http://127.0.0.1:1456/x/oauth/callback`.
5. A temporary loopback listener validates the exact state, exchanges the code,
   fetches the connected account identity, encrypts the token bundle, and
   closes.
6. The Cave UI observes the sanitized connection state and offers the relevant
   familiar grant.

The redirect uses `127.0.0.1`, not `localhost`, and never follows the dynamic
Next development port. Only one authorization attempt may exist at a time. Its
state and verifier expire after 10 minutes and disappear on process restart.

If port 1456 is occupied, Coven Cave reports the exact repair action and does
not terminate the owning process. The callback accepts only the expected path,
method, state, and one-time authorization code. It returns a minimal success or
failure page telling the user to return to Coven Cave.

### Scopes

Research connection requests:

- `tweet.read`
- `users.read`
- `offline.access`

Enabling publishing triggers fresh consent that also requests:

- `tweet.write`

The UI displays granted capabilities from the token bundle rather than assuming
that a completed browser redirect granted every requested scope. A scope
upgrade replaces the bundle only after token exchange and connected-account
validation succeed.

### Token storage and refresh

The encrypted local vault stores one JSON token bundle under
`X_OAUTH_TOKEN_BUNDLE`. It contains access and refresh tokens, expiry, granted
scopes, and the minimal connected-account identifier needed by the UI.

Refresh is single-flight. A rotated refresh token and its access token are
written atomically before waiting requests resume. A failed refresh never
overwrites the last valid bundle with a partial response.

Tokens are never returned to the browser, written to `.env.local`, included in
familiar process environments, persisted in Beads, or logged. Disconnect
removes the bundle, in-memory OAuth state, normalized caches, and temporary
runtime source files. It retains saved source identities, user notes, mission
links, and publish receipts.

## Familiar capability model

`FamiliarBinding` gains two optional flags:

```ts
xResearchEnabled?: boolean;
xPublishEnabled?: boolean;
```

Missing values mean `false`. Publish permission does not imply research
permission, and neither permission is inferred from an app-wide connection.

Familiar Studio's Brain tab gains a `FamiliarXSection` adjacent to other
service integrations. It shows:

- sanitized connected account and granted scopes;
- connect, reconnect, and disconnect actions;
- an **Allow X research** toggle for the current familiar;
- an **Allow X publishing** toggle for the current familiar.

Research Desk and Comms Operations render an honest unavailable state with a
link to Familiar Studio when the account or relevant grant is missing. They do
not initiate a hidden scope or permission upgrade.

The capabilities authorize only the corresponding room-backed local APIs. They
do not inject tokens or general X access into the familiar harness.

## Server modules and route surface

### Modules

- `src/lib/x-api.ts` owns public normalized types, X URL parsing, canonical URL
  construction, and the typed error taxonomy.
- `src/lib/server/x-credentials.ts` owns OAuth state, token encryption,
  refresh, and sanitized connection status.
- `src/lib/server/x-client.ts` is the only module that calls X and normalizes
  successful and failed responses.
- `src/lib/server/x-sources.ts` owns familiar-scoped saved source records and
  bounded content cache lifecycle.
- `src/lib/server/x-publications.ts` owns confirmation tokens, write
  coordination, idempotency, and durable draft/publish records. **Shipped name
  and shape, kept deliberately (cave-uajyn, 2026-08-24):** this document
  originally sketched `x-publishes.ts` behind three routes, mirroring a
  four-state `publishing|published|failed|uncertain` pipeline with separate
  `requestId`/`draftId` fields and a distinct preview-token mint step. What
  shipped instead is one module and one route with a `draft|publish|resolve`
  action discriminator, over a `draft|uncertain|published|abandoned` record
  that IS the draft and the receipt — there is no second file to keep in sync.
  A rename to `x-publishes.ts` alone, without adopting the rest of that
  pipeline, would be cosmetic: it would make the surface look spec-shaped
  while its actual behavior stayed exactly as it is, which is worse than the
  current honest mismatch. Adopting the full three-route/four-state pipeline
  for real was assessed and rejected for this reconciliation: it is a
  state-machine redesign, not a naming fix, its `requestId`/`draftId` split
  buys nothing the unified draft record doesn't already give, and re-deriving
  the "never accept replacement text at publish" guarantee across three routes
  risks the exact regression this reconciliation exists to protect against,
  for no behavioral gain. See `### Local API routes` and `### Approval and
  exact preview` below for what shipped in its place.

No server module exposes a raw X response outside the module that parses it.
All outbound requests use an abort timeout and a strict response schema.

### Local API routes

All Next API routes use the existing local-origin guard and bounded JSON body
reader:

- `GET /api/x/connection`
- `DELETE /api/x/connection`
- `POST /api/x/oauth/start`
- `POST /api/x/posts/lookup`
- `POST /api/x/posts/search`
- `GET /api/x/sources`
- `POST /api/x/sources`
- `DELETE /api/x/sources`
- `GET /api/x/publish` — familiar's draft/uncertain/published/abandoned history.
- `POST /api/x/publish` — `action: "draft" | "publish" | "resolve"`.
  **Shipped shape, kept deliberately (cave-uajyn, 2026-08-24):** this document
  originally specified three routes (`GET /api/x/publishes`,
  `POST /api/x/publish-previews`, `POST /api/x/posts`) matching a
  request-preview-then-post pipeline. The route that shipped folds drafting,
  publishing, and manual resolution of an `uncertain` outcome into one
  action-discriminated endpoint over one durable record per familiar. The
  property that actually matters — `publish` can only ever send the text
  already on that stored record, never anything the request body carries — is
  what `### Approval and exact preview` below documents; the route count
  around it is not load-bearing for that guarantee, and splitting it back into
  three was rejected for the reasons given under `### Modules` above.

The loopback OAuth callback is not a Next route because the desktop development
origin is intentionally dynamic. It is protected by loopback binding, exact
path matching, expiry, PKCE, and one-time state validation.

Routes accept a familiar ID only where a familiar capability is required. The
server resolves the current binding and rejects a disabled capability; the
client cannot assert that permission is enabled.

## Research source model

### Saved identity

Each familiar has a source file at:

```text
~/.coven/cave/x-sources/<familiar-id>.json
```

A saved record contains:

```ts
type SavedXSource = {
  id: string;
  familiarId: string;
  postId: string;
  canonicalUrl: string;
  originalUrl: string;
  note: string;
  tags: string[];
  addedAt: string;
  updatedAt: string;
  attachedMissionIds: string[];
  availability: "available" | "unavailable" | "deleted";
};
```

The X post ID is authoritative. Saving the same post twice for one familiar
updates the existing record rather than creating duplicate research sources.
User notes and tags are Coven data and remain durable even when the X post is
later unavailable.

The durable record does not contain post text, author display data, engagement
metrics, or a raw API payload.

### Normalized cache

Eligible normalized post content is stored separately under:

```text
~/.coven/cave/x-cache/<post-id>.json
```

The cache contains only post ID, canonical URL, text, author ID and handle,
creation time, fetch time, and expiry. It expires no later than 24 hours after
fetch. Expired content is never rendered or materialized.

Every X route entry, Research Desk load, and application startup performs an
expired-entry sweep. An additional best-effort in-process timer may reduce
residue while the app stays open, but correctness does not depend on it.

A successful lookup refreshes the cache. A not-found or deleted response
immediately removes cached and temporary content and marks the durable source
record accordingly. Other read failures retain the identity record but do not
serve expired content.

### Mission source attachment

Research Desk uses the existing mission `attach-source` action. The
`ResearchSourceRef` contract gains X identity fields:

```ts
provider?: "x";
externalId?: string;
availability?: "available" | "unavailable" | "deleted";
```

An X source uses `sourceType: "x-post"` and stores its canonical URL, post ID,
user note, and availability in `sources.json`. It does not copy the post body
into the persistent mission source ledger.

Before a mission iteration launches, the runner rehydrates every attached,
available X source and writes normalized files under the mission's
`runtime/x/` directory. The iteration prompt identifies those files as
user-requested research sources. The runner removes them in `finally` after the
iteration. Startup and launch sweeps remove crash residue older than 24 hours.

If rehydration says a post was deleted, the runner purges temporary/cache data,
updates source availability, and omits the source file. If X is temporarily
unavailable, the iteration reports the unavailable source and continues only
when the mission can do so honestly.

Published research artifacts may cite and synthesize an attached X source, but
the source ledger never embeds the full cached post as an archival copy.

## Research Desk interaction

X support extends the existing **Resources** tab. It does not add a sixth
Research Desk tab or a competing tab strip.

The new **Grab from X** region contains:

- a labeled X post URL field and **Grab post** action;
- a labeled recent-search field with placeholder `Search X posts…`;
- one **Search** action;
- normalized result previews;
- **Save source** and **Attach to mission** actions.

Accepted URLs include current `x.com` post URLs and legacy `twitter.com` post
URLs. Parsing extracts the numeric post ID and canonicalizes the display URL.
Non-post URLs are rejected before an X request.

Recent search follows X's
[recent-search endpoint](https://docs.x.com/x-api/posts/search-recent-posts),
which covers the previous seven days. Each explicit search requests at most 10
results and performs no automatic pagination. Typing, focus, room opening, and
mission status changes never cause an X request.

Result previews show author, text, creation time, and canonical URL. Engagement
metrics are omitted from the MVP. Search results are not durable until the user
selects **Save source**.

Saving is familiar-scoped. Attaching requires a selected mission and creates or
updates its identity-only source reference through the existing action API.
All successful mutations announce completion through `useAnnouncer()`.

## Comms Operations interaction

### Draft compatibility

Comms Operations adds an explicit `x` channel. The existing generic `social`
channel remains available for legacy local drafts and does not gain external
delivery.

Drafts remain familiar-scoped in the existing room state. Changing the channel
or body after approval resets the draft to `draft`. A published draft is
immutable; the user duplicates it to create another post.

### Approval and exact preview

Originally sketched lifecycle:

```text
Draft → Request approval → Approved → Review for X
      → Publish to X → Publishing… → Published
```

**Shipped lifecycle (cave-uajyn, 2026-08-24):** `draft -> confirm -> publish`,
plus `resolve` as the only way out of `uncertain`. There is no separate
"approved" state and no dedicated preview route -- "Request approval" and
"Review for X" collapse into one `POST /api/x/publish` call with
`action: "draft"`, which both saves the wording and mints the confirmation
token in the same round trip. This is the same naming/route decision explained
under `### Modules` above, applied to the state machine it drives.

**Review this wording** (the shipped UI's name for minting a confirmation)
sends the familiar ID and text to `action: "draft"`. The server verifies the
familiar grant, validates the text, stores it, and returns a confirmation
token. **Shipped token design, kept deliberately:** rather than a random,
one-time, in-memory token pointing at a server-held frozen payload, the token
is `<mintedAtMs>.<hmac>`, an HMAC-SHA256 over
`familiarId|publicationId|mintedAt|accountId|text` keyed by a 32-byte secret generated
once per install (`x-publications/.confirmation-key`, `0o600`). The token
does not point at a copy of the text -- it authenticates the exact text
*already stored on the record*, recomputed from disk at publish time. This
was assessed against the random-token design on the properties that design
was chosen for, not adopted as a shortcut:

- **Unguessability** -- from the 32-byte per-install key, same as a random
  token would give.
- **Bound to exact wording** -- *stronger* than the random design: a random
  token is an opaque handle the server must separately remember points at a
  frozen payload, so the token and the text can drift if that bookkeeping ever
  disagrees. A keyed digest recomputed from the live record cannot drift from
  what it authenticates, because it does not point at the text -- it names it.
- **One-time use** -- enforced by the record's own `draft -> uncertain` status
  transition inside the cross-process file lock (`### Idempotency and
  receipts` below), not a separate in-memory consumed-token set. This also
  survives a process restart, which an in-memory map does not.
- **Expiry** -- the one property genuinely absent in the code the audit
  reviewed (cave-1tu16). Fixed in code rather than by amending the spec: the
  token now embeds its own mint timestamp inside the MAC (so it cannot be
  extended by rewriting the timestamp) and is refused as expired ten minutes
  after minting, matching this document's original window exactly.

The one property a random token has that this design does not, and does not
try to: **replay resistance from unpredictability alone.** It does not need
it. A stolen or logged token here is a proof that this *specific text, on
this specific install, was minted for review*; reusing it would still only
ever publish the one wording it was minted for, on the one install that holds
the key, and only once, because the record it names can only leave `draft`
once. There is no scenario in which a bearer benefits from the token being
guessable versus derivable, because deriving it requires the same install
secret a stolen random token would not require at all -- so the random
design's edge here is theoretical, not load-bearing.

The confirmation modal renders the server-returned exact text, the connected
account, an advisory character count, and the statement **No location will be
added.** It uses the shared Modal, focus trap, focus return, and visible focus
ring. The account identity is covered by the same confirmation HMAC as the
wording; reconnecting a different account requires a fresh review instead of
silently sending the approved text under a different identity.

**Publish to X** sends only the confirmation token (plus the familiar and
record IDs needed to look the record up -- never a `text` field the server
would need to ignore). The publish route retrieves the frozen payload from the
stored record and never accepts replacement text with that request: there is
no code path from the parsed request body to the text handed to X, and
`publishXPublication` has no `text` parameter for one to reach through. It
sends only `text` to X's
[create-post endpoint](https://docs.x.com/x-api/posts/create-post); it never
sends geo, media, reply, quote, poll, or scheduling fields. This is the one
property this reconciliation treats as non-negotiable regardless of any other
divergence: see `src/app/api/x/publish-route-behavior.test.ts` for the
behavioral tests that prove it by sending replacement text and reading what
actually reached X, rather than scanning the route's source for the absence of
a `body.text` read.

The advisory count does not replace X's authoritative validation. Coven Cave
does not reject a post solely from a naive JavaScript string length.

### Idempotency and receipts

Originally specified: the server consumes a preview token once; an in-memory
in-flight request map and a durable `requestId` check prevent a double click
from dispatching a second create-post call; a receipt is written as
`publishing` before dispatch; a stale `publishing` receipt becomes `uncertain`
on startup.

**Shipped mechanism, kept deliberately (cave-uajyn, 2026-08-24):** there is no
separate in-flight map or `requestId`. The record itself is written to
`uncertain` -- durably, under a cross-process file lock -- *before* the
network call, and every concurrent or repeated `publish` call for that record
reads that same status inside the same lock: a record already `uncertain` is
refused outright (`ambiguous-write`), and one already `published` is answered
with `alreadyPublished: true` rather than sent again. This gives the same
"exactly once, and a stale in-flight write is never silently replayed"
property the `requestId` design was for, without a second identifier to keep
consistent with the record it describes -- there is only ever one write path
into this file, and the file's own status is the durable claim on "is a write
in flight." The UI-level half of "a double click dispatches one request" --
absent as a test at audit time -- is now covered behaviorally: see
`src/components/role-surfaces/x-publish-panel-behavior.test.tsx`'s "two rapid
Publish clicks dispatch exactly one request", which also closes a real gap the
audit's own framing undersold ("harmless" because the server reconciles it) --
the client did not, until this reconciliation, actually refuse a reentrant
dispatch itself.

Records are stored per familiar at:

```text
~/.coven/cave/x-publications/<familiar-id>.json
```

**Shipped shape, kept deliberately:** the fields below diverge from the
`XPublishReceipt` type this document originally specified.

```ts
type XPublication = {
  id: string;
  familiarId: string;
  text: string;
  status: "draft" | "uncertain" | "published" | "abandoned";
  createdAt: string;
  updatedAt: string;
  dispatchedAt?: string;   // present exactly while status is "uncertain"
  postId?: string;
  canonicalUrl?: string;
  publishedAt?: string;
  resolutionNote?: string; // how a human resolved an uncertain or abandoned draft
};
```

Two differences from the specified `XPublishReceipt`, each decided rather than
merely inherited:

- **No `draftId`/`requestId` split.** One record IS the draft and the receipt
  across its whole life -- there was never a second object for these to
  reconcile against, so nothing needed a foreign key back to it.
- **`status` is `draft | uncertain | published | abandoned`, not
  `publishing | published | failed | uncertain`.** `publishing` does not exist
  as an at-rest state because the record is written straight to `uncertain`
  before dispatch (the crash-safety property `publishing` existed for is
  covered by `uncertain` itself -- see the mechanism note above). A
  deterministic X rejection is not persisted as `failed`: the record simply
  returns to `draft`, because a definite refusal is safe to retry directly
  without a fresh confirmation round trip, and `draft` already means "not yet
  sent, editable, publishable." `abandoned` is reserved for a human explicitly
  walking away from a `draft` or an `uncertain` attempt -- a stronger,
  terminal claim than a transient `failed` would have been.

**The record stores the full post `text`, not a `textSha256`
(cave-uajyn, 2026-08-24; spec amendment, not a planned code change).** This
document's data-minimization reasoning for hashing was written for saved
*research* sources -- third-party content pulled from X, where retaining a
permanent local copy of someone else's post is the specific thing
`### Store complete X posts as permanent research snapshots` (Alternatives
rejected) argues against. A publish record is different content under a
different threat model: it is text the user in front of this install
authored and explicitly asked to post publicly. Two concrete needs a hash
cannot serve, both already load-bearing in the shipped room:

- **The `uncertain` hold has to show what MIGHT have posted.** After a
  dispatch whose outcome X never confirmed, the record can sit unresolved for
  as long as it takes a human to go check X -- hours, potentially longer than
  a session. `unresolvedSummary` (`src/lib/x-publish-composer.ts`) and the
  panel's resolution UI render the literal wording so the person knows exactly
  what to look for on X; a `textSha256` alone gives them nothing to compare
  against what they see on the timeline.
- **"Recent sends" needs to show what was posted.** This document's own
  success criteria say the room "exposes the receipt in recent sends" -- the
  shipped panel's published list renders each record's `text` next to its
  post ID for exactly that. A hash-only receipt could not do this at all.

Given the record already carries `text` for `draft` and `uncertain` -- states
a hash cannot serve either, since drafting requires the literal wording to be
editable and re-displayable -- adding a `textSha256` field once `published`
would not reduce what is stored on disk; the same `text` field is still
populated on the very same record for the two reasons above. It would be a
second, redundant representation of information already present, not a
minimization gain.

If the request fails before dispatch, the draft stays a draft and may be
retried directly. A deterministic X rejection returns the record to `draft`
rather than persisting a separate `failed` status, and publishing it again
needs a fresh confirmation only if the wording changed -- the record's
existing `draft` text is already re-publishable as-is. If the connection
closes, times out, or otherwise becomes ambiguous after dispatch, the record
becomes `uncertain`. The UI tells the user to check X, and Coven Cave never
retries that write automatically.

## Error taxonomy

The client maps X and local failures into typed, user-actionable categories:

- `not-connected`: connect X in Familiar Studio.
- `capability-disabled`: enable X research or publishing for this familiar.
- `missing-scope`: reconnect and grant the required X scope.
- `unauthorized`: refresh once; if that fails, reconnect.
- `billing-unavailable`: X API access or credits are unavailable.
- `rate-limited`: show the safe retry time; do not retry automatically.
- `not-found`: purge cached content and mark the source unavailable or deleted.
- `invalid-request`: preserve X's safe validation summary without a raw body.
- `upstream-unavailable`: retain durable identities and offer a user-triggered
  retry for reads.
- `ambiguous-write`: record `uncertain` and require manual verification on X.
- `invalid-response`: fail closed when X returns an unexpected schema.

Reads may be reissued only by a user action. Authentication may perform one
single-flight refresh before a read or before write dispatch. A create-post
request is never automatically repeated.

Logs may include a local request ID, operation category, elapsed time, and HTTP
status. They must not include OAuth state, verifier, tokens, draft/post text,
query text, raw response bodies, or full user-provided URLs.

## Security, privacy, and policy boundary

- Every Next route rejects non-local origins and bounds request bodies.
- The OAuth callback binds only to loopback and is protected by PKCE, state,
  expiry, exact callback matching, and one-time consumption.
- Familiar IDs and capability flags are resolved server-side.
- X responses pass strict schemas before any state mutation.
- Atomic writes and existing path guards protect familiar-scoped files.
- UI error copy is sanitized and does not expose tokens, private paths, or raw
  upstream payloads.
- X content is used only for the user's bounded, requested research task. It is
  not added to training, profiling, surveillance, or broad monitoring flows.
- Publishing always requires the user's exact-payload confirmation and follows
  X's [automation and restricted-use policies](https://docs.x.com/developer-terms/restricted-use-cases).

This MVP uses bounded cache expiry plus revalidation on active use. If future
retention or volume requires continuous deletion compliance, that capability
must be designed separately against X's current compliance products before
retention is expanded.

## Design-system requirements

The implementation follows `docs/coven-design-language.md` as a binding
contract:

- reuse Button, Modal, EmptyState, ErrorState, Skeleton, SearchInput, and other
  existing primitives before adding room-local equivalents;
- use tokens only and verify all 21 palettes in light and dark mode;
- keep Research Desk's five-tab architecture and the room header action budget;
- use persistent labels and the exact `Search X posts…` placeholder grammar;
- use `Grab post`, `Save source`, `Request approval`, `Publish to X`,
  `Publishing…`, and `Published` as lifecycle copy;
- distinguish not connected, empty, loading, rate limited, unavailable, and
  deleted states;
- apply `.focus-ring`, focus trap/return, keyboard dismissal, and announcer
  semantics;
- provide reduced-motion behavior for any progress or transition;
- use container-aware layouts that survive narrow native panes;
- import surface CSS from the owning component rather than the global facade.

The X confirmation is a modal because it is the final irreversible external
action. Research lookup and search stay inline because they are reversible,
user-triggered reads.

## Migration and compatibility

- Existing bindings without X fields deserialize with both capabilities
  disabled.
- Existing Research Desk sources need no migration; the X identity fields are
  optional.
- Existing Comms `social` drafts retain their channel and local-only behavior.
- No X data files are created until the user connects, saves, or publishes.
- Disconnecting does not delete user-authored notes, mission links, or receipts.
- A source with expired content remains visible as a saved reference and offers
  an explicit refresh when connected.

## Testing and verification

### Unit and server tests

- X and legacy Twitter URL parsing, ID extraction, and canonicalization.
- Strict success schemas and error mapping for 401, 402, 403, 404, 429,
  malformed JSON, and unexpected response shapes.
- OAuth state expiry, mismatch, replay rejection, PKCE challenge generation,
  callback port collision, and account identity validation.
- Token encryption, refresh single-flight behavior, refresh-token rotation,
  atomic replacement, disconnect, and secret redaction.
- Per-familiar capability defaults and enforcement.
- Source deduplication, atomic persistence, cache expiry/sweep, not-found purge,
  and absence of raw post content in durable records.
- Mission-time hydration, unavailable sources, `finally` cleanup, and crash
  residue cleanup.
- Exact-preview token expiry and one-time consumption.
- Publish double-click suppression, successful receipt, deterministic failure,
  and ambiguous-write handling with no second dispatch.

### UI tests

- Research lookup, bounded recent search, save, duplicate save, attach, refresh,
  missing connection, missing grant, rate limit, deletion, and announcement.
- Explicit X channel alongside unchanged generic social drafts.
- Editing an approved X draft revokes approval.
- Confirmation shows the exact server-returned text and no-location statement.
- Publish sends only the preview token, renders success ID/URL, suppresses
  double click, and treats ambiguous failure as manual verification.
- Keyboard-only modal use, focus return, visible focus, and reduced motion.
- Wide and narrow Research Desk and Comms Operations containers.

### Repository gates

- Add every new API route alphabetically to
  `src/app/api/api-contracts.test.ts`.
- Wire every new test file into `scripts/run-tests.mjs`.
- Run focused tests and `pnpm check:tests-wired`.
- Run `pnpm typecheck`, `pnpm lint`, and `pnpm codemod:design:check`.
- Run the raw design-token drift suite without the CSS loader hook.
- Run `pnpm test:app`, `pnpm test:api`, and the production build.
- Launch the real Tauri app with `bash scripts/dev-app.sh`.
- Exercise Research Desk and Comms Operations at wide and compact widths in
  Coven light, Coven dark, and a non-default palette.

Live X verification uses an OpenCoven test account, configured client ID, and
API credits. Credentials are never committed or placed in fixtures. If live
access is unavailable, mocked verification can prove local behavior but the
release remains explicitly blocked on lookup, search, refresh, publish-success,
and ambiguous-write smoke evidence against X.

## Acceptance audit

The MVP is complete only when all of the following are true:

- account connection and scope upgrade work without exposing credentials;
- both familiar capabilities default off and are enforced on the server;
- one URL lookup and one capped recent search produce normalized previews;
- saved X identities survive restart without retaining permanent post bodies;
- attached sources hydrate for a mission and temporary files are removed;
- exact-preview confirmation publishes one text-only post;
- success records ID and URL, and ambiguous results never auto-retry;
- missing auth, scope, credits, rate limit, deletion, and malformed responses
  fail closed with an actionable state;
- API route inventory, test wiring, repository gates, and native UI checks pass;
- live X smoke evidence exists before release.
