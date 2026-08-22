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
tombstone surviving a store reload, and the revoked bearer being refused; and
every admin route answering `503` when `COVEN_CAVE_AUTH_TOKEN` is unset —
together with the consequence that matters, which is that a pairing opened on a
tokenless Cave can only ever answer `pairing_pending`.

**Canonical reads (#4838)** — all five routes; empty first page, exact-multiple
page, continuation, partial final page, and `hasMore` in both directions;
projection shape as a whole key set, with each withheld field named as a leak
rather than as drift; cursor stability — replaying a cursor returns the same
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
`scripts/client-v1-conformance.test.mjs` is in the `api` suite, and every one of
its cases is a negative one: it feeds each assertion helper the exact broken
server behaviour the run exists to catch and demands a failure. An assertion
helper that cannot fail turns a green record into a lie, and nothing else in the
suite would notice. `scripts/ci-paths.mjs` also routes the harness, this
runbook, and the results directory into the client-v1 lane, so a change to any
of them is validated by the lane that owns the surface.

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
**91 passed, 0 failed, 0 skipped** at `63f14013` on `win32-x64`, run with
`--include-ttl`, so `pairing.ttl-poll-expired` and `pairing.ttl-exchange-expired`
are recorded as passes rather than skips.

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

Two things the exercise showed that are worth keeping:

- **The leak mutation had to be made twice.** Adding `reasoning` to the
  projection alone does not compile — `ClientV1MessageRecord` is a closed
  literal type, so `tsc` refuses the field before any build produces it. A real
  leak therefore has to widen the published type as well, and that is the shape
  the mutation above uses. The type is the first gate; this run is the second.
- **The `next`-suppressing mutation *skipped* rather than failed three legs.**
  `reads.cursor-replay-is-stable`, `reads.cursor-survives-deletion` and
  `reads.conversations-mutable-key-moves-a-row` all need a first-page token to
  open a cursor with, so a server that publishes none leaves them unrun. They
  are reported as skips and, per the rule above, a skip is not a pass — the four
  walk assertions are what fail. Read a jump in the skip count as a signal, not
  as noise.
