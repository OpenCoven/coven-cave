# Client v1 — Real-Authority Conformance

Chat v1 Phase 1 (`cave-0prpu`, [#4832](https://github.com/OpenCoven/coven-cave/issues/4832))
and Phase 2 (`cave-hjy2f`, [#4838](https://github.com/OpenCoven/coven-cave/issues/4838)).
Both gates are governed by the program's **operating rule 8: a gate cannot close
on unit-test proxies alone.** This runbook is the repeatable form of that
evidence.

```bash
pnpm build                                   # the run drives the assembled artifact
pnpm test:client-v1:conformance              # ~40 s, exit 0 or 1
pnpm test:client-v1:conformance --include-ttl \
  --out docs/client-v1-conformance-results/<date>-v<version>-<platform>.json
```

## What "real authority" means here, and why the unit tests are not it

`src/lib/server/client-v1/**` and every `route.test.ts` under
`src/app/api/client/v1/` call the exported handler with a hand-built
`NextRequest`. That is the right shape for those tests, and it means none of
them can see any of this:

| Layer | Only observable over a socket |
|---|---|
| `server.mjs` | strips any client-supplied `x-coven-cave-local-peer` and re-stamps it for direct, unforwarded loopback peers only. Every handler test supplies the stamp itself. |
| `proxy.ts` | the escaped-target refusal, the direct-loopback gates for the public / authenticated / admin families, the 411/413/64 KiB control-plane body rules, and the sidecar-token gate that runs **ahead of** `requireClientV1Admin`. |
| Next | its own request-target normalisation and dynamic-segment decoding — which is what made `cave-f1xki` reachable in the first place. |
| Node's HTTP client | not a layer, but the reason two of these are hard: it rewrites targets and substitutes chunked encoding, so parts of the run are written straight onto the socket. |
| the stores | a real `client-v1-credentials.json` written 0600 and re-read from disk, a real transcript directory, a real `projects.json`. |

The run therefore starts a Cave, drives it over `127.0.0.1`, and stops it.

## Scope — the Cave half only

#4838 names Cave, the SDK and Chat. **The SDK and Chat halves live in other
repositories and are not exercised here.** A green record from this harness is
evidence about Cave and about nothing else.

The run also says, in its own evidence record (`notCovered`), what a pass does
not mean:

- the production Coven daemon — `/familiars` projects a daemon HTTP response, so
  the run stands up a fixture daemon on loopback and points the fixture Cave at
  it in hub mode;
- a genuinely remote peer — off-machine ingress is exercised by making the
  *listener* classify a loopback request as forwarded, which is the same signal
  it reads for a real remote peer, but nothing in this run originates elsewhere;
- the write scopes — nothing enforces them yet, because there are no write
  routes on this surface;
- OAuth-backed flows and the desktop consent UI — approval is driven through the
  admin HTTP route;
- cross-process pairing state — the pairing store is in-memory and
  process-local by contract.

## It never touches your real Cave

Every run mints its own `COVEN_HOME` / `COVEN_CAVE_HOME` under the system temp
directory, its own admin token, and its own port, and removes all of it
afterwards. This is not a nicety: an earlier hand-driven cycle ran against the
operator's real `~/.coven` and left a live paired credential behind that had to
be revoked by hand. `--keep-fixture` leaves the temp home in place for
inspection and prints its path.

## What it covers

**Pairing and revocation (#4832)** — create, poll pending, admin approve, poll
approved, exchange, and a bearer that then works; deny, and the terminal
`pairing_denied`; replay of a consumed exchange (`conflict` /
`pairing_replayed`) on both the exchange and the poll; a well-formed wrong
secret; the per-pairing failure budget, including that it is shared between the
poll and the exchange, that a correct secret is never charged, that spending it
locks out the rightful holder, and that the lockout is confined to one pairing;
idempotent re-approval and the contradicting-decision conflict; revocation, the
tombstone surviving a store reload, and the revoked bearer being refused **by
all five canonical reads** — `read-guard.ts` keeps the credential decision
written out in each route module rather than delegated, so there are five copies
of it and a single-route probe clears one; and
every admin route answering `503` when `COVEN_CAVE_AUTH_TOKEN` is unset —
together with the consequence that matters, which is that a pairing opened on a
tokenless Cave can only ever answer `pairing_pending`.

**Canonical reads (#4838)** — all five routes; empty first page, exact-multiple
page, continuation, partial final page, and `hasMore` in both directions;
projection shape as a whole key set, with each withheld field named as a leak
rather than as drift, **and every projected value checked against what the
fixture seeded** — a key-set check alone passes `root: project.id` and
`harness: summary.harnessSessionId`, both measured; cursor stability — replaying a cursor returns the same
page, `current` echoes the token sent, and deleting the record a cursor *names*
does not strand the walk; the `limit` ceiling and every refused spelling, the
unsupported and repeated parameter refusals, and the two cursor refusals; the
single-record route refusing any query parameter at all; the messages route
serving the active branch and omitting the abandoned one, paging by position,
answering `reconcile_required` when the branch moves under an open cursor, and
restarting cleanly afterwards.

**Ingress** — the escaped-target refusal, the forwarded-peer refusals for all
three route families, the 411 for a missing `Content-Length`, the 400 for a
chunked control-plane body, the 413 body cap, and the 415 content-type refusal.

`pairing.ttl-expiry` is **skipped by default**. The TTL is five minutes of real
time and there is no clock seam reachable from outside the process, so the only
honest way to observe `pairing_expired` is to wait for it. `--include-ttl` waits;
without it the run records a skip, and a skip is never counted as a pass.

## Operator-invoked, not CI

The run needs a full production build, a spare port, a spawned server and a
fixture daemon, and it is inherently serial. Adding that to the path-aware PR
lane would put minutes onto every client-v1 change to re-prove a property that
does not change per commit — which is the same reason `client-v1-release-smoke.mjs`
is operator-invoked, and the same trade
[Release Acceptance](release-acceptance.md) makes explicitly: *the journey is
manual by design; what is automated is the evidence.*

What **is** wired into CI is the half that decides whether a run passes.
`scripts/client-v1-conformance.test.mjs` is in the `api` suite, and most of its
cases are negative ones: they feed each assertion helper the exact broken server
behaviour the run exists to catch and demand a failure. (The rest pin the
fixtures, which is the other half of the same job — an assertion over data that
never carried the field it forbids proves nothing, and that is exactly how the
message projection leg went inert; see the mutation table below.) An assertion
helper that cannot fail turns a green record into a lie, and nothing else in the
suite would notice.

Every helper mutation attempted against that suite is killed by it: 37 of 37,
covering each branch of `checkEnvelope`, `checkRecordShape`, `checkRecordValues`,
`checkPageWalk`, `checkEmptyFirstPage`, `checkAssertionCoverage`,
`summarizeConformance`, `recorder.expect`, `parseConformanceArgs`,
`parseRawResponse`, every `RECORD_SHAPES.*.forbidden` list, and every fixture
invariant.

`scripts/ci-paths.mjs` also routes the harness, this runbook, and the results
directory into the client-v1 lane. Note the harness was already covered before
that edit — `scripts/` is in `FRONTEND_PATH`, so `frontend-validation (API
tests)` ran on any change to it — so the routing adds the e2e and docs lanes
rather than closing a hole.

Run it before closing either gate, and when a change lands in `proxy.ts`,
`server.ts`, or `src/lib/server/client-v1/**`.

## The evidence record

Records live in `docs/client-v1-conformance-results/<date>-v<version>-<platform>.json`
and carry every assertion id with its result, the `notCovered` list above, the
`findings` below, the Cave version, the platform, the exact commit, and whether
the TTL leg ran. The commit is there for the reason
[Release Acceptance](release-acceptance.md) records artifact digests: a record is
a claim about *which bytes* answered, and one that cannot say which has not made
the claim.

The committed record for `cave-2hjtv` is
[`2026-08-22-v0.3.9-win32.json`](../client-v1-conformance-results/2026-08-22-v0.3.9-win32.json):
**93 passed, 0 failed, 0 skipped** at `12ed1f73` on `win32-x64`, run with
`--include-ttl`, so `pairing.ttl-poll-expired` and `pairing.ttl-exchange-expired`
are recorded as passes rather than skips.

⚠️ **Take the record from a clean tree, and commit the code before the record.**
The first version of this file named `63f14013` — the *base* commit. The run had
been taken from a dirty checkout, so `git rev-parse HEAD` answered the commit
before the harness existed: nothing in the record was reproducible from the
commit it named. The order that works is code first, then run, then commit the
record on its own, so the commit the record names really is the harness that
produced it and the only difference is the artifact itself.

Commit the record. A conformance claim whose evidence is a terminal scrollback
is an assertion, not a record.

### Do not commit credentials

The run mints a per-run admin token and per-run bearers, and **none of them
belongs in a record.** The harness writes only assertion ids, results and its
own diagnostic strings; if you add an assertion, keep secrets out of its detail
text. Bearers and pairing secrets are 43 base64url characters and are trivially
recognisable — but the rule is to not write them, not to scan for them.

## Findings a green run still reports

The harness is written against what the wire does, not against what the
reference says, and where the two disagree it asserts the measured behaviour and
records the gap. Three stand today, all documentation-level — the gates
themselves hold:

1. **The backslash half of the escaped-target refusal is unreachable.**
   `docs/api/client-v1.md` says a target inside `/api/client/v1` containing `%`
   *or* `\` is answered `400 invalid client v1 path`. The `%` half holds. A `\`
   is normalised to `/` by Next in the request target and answered `308` to the
   normalised target before `proxy.ts` runs; that target is not a client-v1
   route and is refused `401`. Nothing is served and no handler is reached, so
   the gate holds — but the documented answer is one no client will observe.

2. **`requireClientV1Admin`'s `unauthorized` envelope is unreachable.** On a
   Cave with `COVEN_CAVE_AUTH_TOKEN` set, a wrong or absent `x-coven-cave-token`
   is refused by the proxy's ordinary sidecar-token gate first, so the wire
   carries `401 {"ok":false,"error":"unauthorized"}` rather than the Client v1
   envelope the reference describes. Same status, different body — and a
   handler-level test cannot tell, because it never runs the proxy.

3. **`/conversations` skips rather than repeats under a mid-walk touch.** The
   reference and `reads.ts` both say a conversation that receives a turn while
   you are paging "can appear in two pages". The ordering is `updatedAt`
   **descending** and a touch only raises the key, so a touched row moves
   *above* an open cursor: one already served stays served, and one not yet
   served is skipped by the rest of the walk. No repeat was reproducible. The
   client-visible consequence is the opposite of the documented one — a repeat
   is deduplicable by `id`, a skip is silent unless the client re-reads from the
   top.

## Harness mutation results

A conformance run that passes against a broken server is worse than none, so the
harness is checked against deliberately broken builds rather than trusted. Each
mutation patched source, ran a full `pnpm build`, ran the harness, and restored
the source. Measured 2026-08-22 on `win32-x64` against Cave 0.3.9.

| Mutation | Result | Assertions that caught it |
|---|---|---|
| `paginateClientV1Keyset` never publishes `next` | **caught**, 4 failures | `reads.familiars-paging`, `reads.projects-paging-partial-final-page`, `reads.projects-paging-exact-multiple`, `reads.conversations-paging` |
| `ClientV1MessageRecord` widened and `projectClientV1Message` serves `reasoning` + `costUsd` | **caught**, 1 failure naming 12 leaks | `reads.messages-active-branch`, naming both fields on all six turns |
| `FileCredentialStore.findByBearer` ignores `revokedAt` | **caught**, 1 failure | `revocation.bearer-refused-after` |
| `parseClientV1PageLimit` clamps instead of refusing | **caught**, 5 failures | every `reads.refuses.limit-*` case: zero, over-ceiling, leading zero, exponent, signed |

### The four that were NOT caught, and what closed them

An independent review built a second set aimed at the assertions rather than at
the routes, and **all four passed a full run** — 89 passed, 0 failed, exit 0,
against one build carrying every one of them at once:

| Mutation | Before | After |
|---|---|---|
| `projectClientV1Message` serves `reasoning` and the tool calls **when the turn has them** | **passed** | `reads.messages-active-branch` names both leaks |
| `projectClientV1Project` serves `root: project.id` | **passed** | `reads.projects-shape`, all seven rows |
| `projectClientV1Conversation` serves `harness: summary.harnessSessionId` | **passed** | `reads.conversations-shape`, all six rows |
| `projectClientV1Message` serves `text: turn.role` | **passed** | `reads.messages-values`, all six turns |

Two causes, both now fixed:

- **`checkRecordShape` checks KEYS ONLY.** A projection that serves the wrong
  field, or a withheld *value* under an allowed *key*, keeps every key and was
  invisible. `checkRecordValues` is the other half, and the projects,
  conversations and messages legs now use both. The `harness` /
  `harnessSessionId` pair is the case that matters: adjacent fields, one
  published and one withheld, and only a value check tells them apart.
- **The branched transcript carried nothing worth withholding.** Its turns had
  no `reasoning`, no `tools`, no `usage`, no `costUsd` and no `attachments`, so
  `RECORD_SHAPES.message.forbidden` had nothing to forbid and both counts were
  zero everywhere — `reads.messages-counts-not-contents` could not fail for any
  wrong count. `b-a1` now carries all of them, two tool calls and one
  attachment, and the counts are asserted as 2 and 1 rather than as "a number".
  The earlier note that the leak mutation "had to be made twice" because the
  type is closed still holds, but widening it is three lines; the type is a
  speed bump, not the first of two gates.

### Legs that used to vanish rather than skip

The `next`-suppressing mutation above leaves the cursor legs unrun, because they
need a first-page token to open a cursor with. The first write-up said they were
"reported as skips". Two of them were reported as **nothing at all**:
`reads.cursor-replay-is-stable`, `reads.cursor-current-echoes-the-token` and
`reads.cursor-survives-deletion` sat behind `if (firstPage.next)` with no `else`,
so their ids simply left the record — a smaller, still-green run, with the
shortfall visible only to a reader who remembered the expected total. The same
held for `reads.messages-restart-after-reconcile` and
`admin.unconfigured.exchange-stays-pending`.

Every such guard now records a skip, and `EXPECTED_ASSERTION_IDS` makes that
checkable instead of conventional: the run ends by comparing what it recorded
against the declared set and fails `harness.assertion-coverage` on any id that is
missing, duplicated or unexpected. A skip still does not fail a run — but a
silence now does. **Add an id to that list in the same change that adds the
assertion.**
