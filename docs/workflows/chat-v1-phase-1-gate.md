# Chat v1 Phase 1 Gate — Discovery and Pairing Vertical Slice

Bead `cave-23nmv` / executing child `cave-ob9ue`,
[#4833](https://github.com/OpenCoven/coven-cave/issues/4833).

**Verdict, 2026-08-23: NOT PASSED.** Cave's half of the slice is implemented and
now genuinely guarded. The SDK and Chat halves do not exist, so the *vertical*
slice this gate names cannot be certified from this repository.

This record exists so that verdict is reproducible rather than a claim, and so
the next attempt starts from measured coverage instead of re-deriving it.

## Why a gate is not a test run

Phase 1's plan of record is `OpenCoven/chat`
`docs/superpowers/plans/2026-08-15-phase-1-discovery-pairing.md`, superseded in
its implementation detail by the 2026-08-20 split plans (`phase-1a` Cave,
`phase-1b` SDK, `phase-1c` Chat, `phase-1d` conformance). Its **Exit Gates**
section is the acceptance criteria, and every one of them is a claim about
three repositories at once.

The program's operating rule 8 — *a gate cannot close on unit-test proxies
alone* — is why `docs/workflows/client-v1-conformance.md` exists. This document
is the layer above it: rule 8 says a passing unit test is not evidence, and this
gate additionally asks whether the unit tests **could have failed**. A suite
that cannot fail is not a weaker proxy than a socket run; it is not evidence at
all.

That question is not rhetorical here. Of eighteen mutations applied to shipped
Phase 1 behaviour, **five survived every suite that plausibly covered them**,
and two of the five were guarded by tests whose *names* state the exact property
the mutation destroyed.

## Acceptance criteria → evidence

Criteria are the plan's Exit Gates, plus the Cave-side deliverables of Tasks
1–3 that the gate title ("discovery and pairing") names directly.

| # | Criterion | Owner | Status | Evidence |
|---|---|---|---|---|
| EG1 | Pairing secrets and bearers absent from JS logs, Rust logs, Playwright traces, screenshots, config output | Cave / SDK / Chat | **Partial** | Cave: `M01`, `M09`, `M16` all caught — the credential file holds only a SHA-256 bearer hash, the pairing store only a secret hash, and the secret is read from `X-Coven-Pairing-Secret` and nowhere else. Rust logs, Playwright traces and screenshots have no owning repository yet. |
| EG2 | Replayed exchanges and revoked credentials fail explicitly | Cave | **Met** | `M08` (replay), `M03` (revoked bearer resolves), `M04` (revocation not persisted) all caught; socket-level confirmation in `docs/client-v1-conformance-results/`. |
| EG3 | Restarted Chat reconnects without pairing again | Chat | **Not met** | No Chat implementation. See below. |
| EG4 | Wrong API major produces an upgrade-required state | Cave / Chat | **Cave half only** | `M18` caught by `contract.test.ts`: `minimumClientVersion` is pinned and rides the envelope. The *client* half — a client that reads it and enters `incompatible` — is Chat's `ConnectionState`, which does not exist. |
| EG5 | Packaged Chat and packed SDK/CLI pair against real Cave | Chat / SDK | **Not met** | Neither artifact exists. |
| EG6 | Neither Chat nor the SDK exposes a raw private-route or arbitrary HTTP client | SDK / Chat | **Not assessable** | Cave-side counterpart (`M17`, the exchange route's direct-loopback gate) was **unguarded until this change**. |
| T1 | Pairing records process-local, 5-minute TTL, SHA-256 secret hashes only | Cave | **Met** | `M06`, `M09` caught. Note `pairing-store.test.ts` expresses the TTL relative to `PAIRING_TTL_MS`, so the five minutes is pinned by `pairing/requests/route.test.ts`, not by the store's own suite. |
| T1 | Credentials: token hash only, constant-time verification, revocation survives restart, `lastUsedAt` at most once per minute | Cave | **Met except constant-time** | `M01`, `M04`, `M05` caught. **`M02` survived** — see Finding 3. |
| T2 | Invalid tokens must not consume a valid credential's bucket | Cave | **Met (repaired here)** | **`M14` survived** two tests named for this property. See Finding 2. |
| T2 | Remote ingress is rejected; admin paths do not use the client bypass | Cave | **Met (repaired here)** | **`M17` survived** every suite. See Finding 1. |
| T3 | Discovery record at `<caveHome>/client-v1-discovery.json`, mode 0600, validated loopback endpoint, nonce-safe shutdown cleanup | Cave | **Met** | `M10`, `M11`, `M13` caught. `M12` (mode 0600) is asserted only on POSIX — see Coverage limits. |
| T3 | Pairing secrets travel only in `X-Coven-Pairing-Secret` | Cave | **Met (repaired here)** | **`M16` survived** on the exchange route while its sibling poll route caught it. See Finding 1. |

## Cross-repository state, measured 2026-08-23

| Bead | Issue | Owner | State |
|---|---|---|---|
| `cave-9pifu` | [#4829](https://github.com/OpenCoven/coven-cave/issues/4829) | Cave | **Closed.** Landed as PR #4840. |
| `cave-0prpu` | [#4832](https://github.com/OpenCoven/coven-cave/issues/4832) | Cross-repo | **Closed.** Landed as PR #4859 (Cave half only; the SDK and Chat halves are recorded in that run's own `notCovered`). |
| `cave-lf7bu` | [#4831](https://github.com/OpenCoven/coven-cave/issues/4831) | SDK | **Open, not started.** A code search for `pairing` across `OpenCoven/sdk` returns 0 results. |
| `cave-p8qkk` | [#4780](https://github.com/OpenCoven/coven-cave/issues/4780) | SDK | **Open, partial.** `OpenCoven/sdk` PR #30 (`3ab5b3132`, 2026-08-22) landed Coven discovery and the Unix / Windows named-pipe transports. `opencoven coven health` and the CLI diagnostics are not in it. |
| `cave-tsvfj` | [#4830](https://github.com/OpenCoven/coven-cave/issues/4830) | Chat | **Open, not started.** A code search for `pairing` across `OpenCoven/chat` returns 0 results; chat#25 merged the Phase 1 *plan* only. |

Three of the gate's five blocking beads are open, and two of those three own
every criterion in EG3, EG5 and half of EG4 and EG6. **No amount of Cave-side
evidence closes this gate.**

## Mutation matrix

Each row is a deliberate defect applied to shipped source, with every suite that
plausibly covers it executed under the runner's own argv. `SURVIVED` means the
defect shipped green.

| # | Defect | Result | Killed by |
|---|---|---|---|
| M01 | `hashBearer` returns the bearer instead of its SHA-256 | caught | `credential-store` (9), `exchange/route` (2) |
| M02 | Credential hash compare uses `===` instead of `timingSafeEqual` | **SURVIVED** | — (Finding 3) |
| M03 | `findByBearer` ignores `revokedAt` | caught | `credential-store` (3) |
| M04 | `revoke` mutates in memory without persisting | caught | `credential-store` (4) |
| M05 | `lastUsedAt` write interval 60 000 ms → 1 ms | caught | `credential-store` (1) |
| M06 | `PAIRING_TTL_MS` 5 min → 50 min | caught | `pairing/requests/route` (1) |
| M07 | Pairing secret compare uses `===` | **SURVIVED** | — (Finding 3) |
| M08 | Approved pairing never consumed (replayable) | caught | `pairing-store` (3), `exchange/route` (2) |
| M09 | Pairing secret persisted raw instead of hashed | caught | `pairing-store` (7) |
| M10 | Discovery accepts any hostname | caught | `discovery` (1) |
| M11 | Discovery removes a record whatever the nonce | caught | `discovery` (1) |
| M12 | Discovery record opened 0666 | survived **on win32 only** | asserted on POSIX; see Coverage limits |
| M13 | Discovery accepts path, query and fragment | caught | `discovery` (1) |
| M14 | `consumeInvalidBearer` charges the `authenticated` bucket | **SURVIVED** | now caught (Finding 2) |
| M15 | Pairing failure budget keyed globally, not per pairing id | caught | `rate-limit` (3), `exchange/route` (1) |
| M16 | Exchange accepts the pairing secret from a URL query parameter | **SURVIVED** | now caught (Finding 1) |
| M17 | Exchange's direct-loopback gate removed entirely | **SURVIVED** | now caught (Finding 1) |
| M18 | `CLIENT_V1_MIN_CLIENT_VERSION` changed | caught | `contract` (6) |

Suites executed against M14, M16 and M17 before concluding they survived:
the route's own suite, the sibling poll route's suite,
`authenticated-route-refusal.test.ts`, `api-contracts.test.ts` (302 contracts),
`admin/security.e2e.test.ts`, `middleware.test.ts`, `familiars/route.test.ts`,
`auth.test.ts` and `rate-limit.test.ts`.

### Confirmation round — the repairs are load-bearing

| # | Defect | Result |
|---|---|---|
| C1 | Loopback stamp checked, answer ignored (`&& false`) | caught |
| C2 | Route refuses unconditionally — **positive control** | caught (7 of 7 fail, so the new tests are not vacuously passing) |
| C3 | `isTrustedLoopback` accepts the empty stamp | caught |
| C4 | Query secret preferred over the header | caught |
| C5 | `pairing-create` merged into `invalid-bearer` | caught |
| C6 | `authenticated` merged into `invalid-bearer` | caught (only the new matrix catches this one) |
| C7 | `pairing-exchange-failure` merged into `pairing-create` | caught |

## Findings

### 1. The exchange route had no locality or secret-placement gate under test

`cave-f1xki` (#4854) hardened the pairing **poll** route with three tests:
`poll refuses a caller without the listener's direct-loopback stamp`,
`poll accepts pairing secrets only from the reviewed header`, and
`poll checks the loopback stamp before it reads the rate-limit budget`.

The **exchange** route got none of them. It mentions `LOCAL_PEER_HEADER` eleven
times, and all eleven are happy-path setup: every request the file builds
supplies the valid stamp, because every scenario it describes is a legitimate
client. Deleting the route's entire `isTrustedLoopback` branch left the file
green, and so did adding a URL-query fallback for the pairing secret.

This is the more consequential of the two routes. The poll route discloses a
status; the exchange route **mints the bearer**.

Repaired by porting both refusal tests onto the exchange route, with a positive
control (C2) proving they are not satisfied by blanket refusal, and an assertion
that a refusal neither mints a credential nor spends the approval — an unstamped
caller must not be able to burn a pairing the legitimate holder still needs.

### 2. Two rate-limit tests named for category isolation could not observe its loss

`rate-limit.test.ts` carried:

- `invalid bearer attempts use a separate bounded bucket and never spend valid credential budget`
- `pairing, invalid bearer, and authenticated categories are isolated even for the same key`

Pointing `consumeInvalidBearer` at the `authenticated` bucket passed both.

- The first varies the **key and the category together** (`"loopback"` versus
  `"credential-a"`). Buckets are keyed by (category, key), so a category
  collision is hidden behind a key collision that never happens. It proves keys
  are independent — which the test above it already proved.
- The second holds the key fixed but exhausts only `pairing-create`, then checks
  that `invalid-bearer` and `authenticated` still answer. A merge *between those
  two* leaves both final assertions true, because neither was ever spent.

Replaced with a pairwise matrix: for each of the four categories, exhaust it
under a shared key on a fresh limiter and require the other three to answer with
their own full budget minus one. Any merge of any two categories now fails.

### 3. Constant-time comparison is unguarded, and cannot be fixed by a unit test

`M02` and `M07` both survived. The comparison sites are `hashesEqual` in
`credential-store.ts` (bearer hashes) and in `pairing-store.ts` (pairing secret
hashes); replacing `timingSafeEqual` with `===` at either site passes every
suite.

The only constant-time guard anywhere on this surface is in `auth.test.ts`,
and it is a **source regex** over `auth.ts` — it pins
`timingSafeEqualString(headerValue, loopbackSecret)` as text. It does not reach
either store.

**No behavioural repair was attempted, deliberately.** Constant-time is a timing
property, and the two stores' inputs are fixed-length validated hex, so there is
no I/O-observable difference between the two implementations — a deterministic
assertion that fails on `===` does not exist, and a statistical one would be
flaky in CI. Extending the source-regex pattern to the two stores was rejected
for the reason `authenticated-route-refusal.test.ts` states in its own header:
a gate satisfied by writing the right words rather than by the behaviour holding
reproduces the defect it is meant to catch. Recording the gap honestly is worth
more than a guard that would report coverage it does not have.

Filed as `cave-ob9ue.1` rather than closed silently.

## Coverage limits of this record

- **`M12` (discovery record mode 0600) is a win32 non-result, not a gap.**
  `discovery.test.ts` skips its POSIX mode assertions on win32 by design and
  says so (`assertOwnerOnlyMode`): NTFS reports 0o666 for every regular file
  whatever mode `open` was given, so asserting there would measure the platform
  rather than the publisher. The assertion runs and is load-bearing on Linux CI.
  This matrix was produced on Windows and cannot speak to it.
- **Handler-level only.** Every mutation here was applied to source and observed
  through exported handlers and store modules. Nothing in this matrix crosses a
  socket; `server.mjs`'s stamp minting, `proxy.ts`'s ingress classification and
  Next's target normalisation are covered by
  `docs/workflows/client-v1-conformance.md` and its recorded runs, not here.
- **Cave only.** No SDK or Chat code was executed, because none exists.

## What would close this gate

1. `cave-lf7bu` — SDK Cave client: discovery, health, pairing exchange,
   credential handling behind a `SecretStore`.
2. `cave-p8qkk` — the remainder of the Coven IPC work: `opencoven coven health`
   and the CLI diagnostics.
3. `cave-tsvfj` — Chat native discovery, launch, keychain, constrained
   transport, and the connection state machine EG3 and EG4 are claims about.
4. A real-authority run spanning all three, per `phase-1d`. The Cave half of
   that harness already exists and is the shape the rest should join.

Until then this gate stays open, and Cave's evidence should be cited as what it
is: one repository of three.
