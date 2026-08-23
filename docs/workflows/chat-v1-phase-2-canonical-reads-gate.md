# Chat v1 Phase 2 gate — canonical reads verified

Gate issue: [#4839](https://github.com/OpenCoven/coven-cave/issues/4839) · bead `cave-8ywi2`
(mirrored as [#4906](https://github.com/OpenCoven/coven-cave/issues/4906)) · executed as
`cave-ma00l`.

A phase gate closes on verified evidence, not on code. This is that evidence, and the
verdict it supports.

---

## Verdict

**The gate does not pass. The Cave lane does.**

The criterion that fails is *"All Phase 2 beads are closed"*. Three of the gate's five
blockers are open, and two of those are in repositories this one does not own. Nothing in
Cave can close them, and no amount of Cave evidence substitutes for them: the gate's own
framing is *canonical reads across Cave, SDK and Chat*, and a third of that is what has
been proven.

What **is** proven, to a standard worth stating plainly: the Cave canonical read surface
does what it claims. Five routes, real-authority conformance over a socket against a
release build, and — the part that is new here — a mutation matrix showing the tests that
guard it fail when the behaviour they name is broken. Forty-three mutations, thirty-six
caught on the first pass, seven survivors, all seven since closed. No mutation found a
defect in the shipped code; the seven survivors were all cases where correct code was
guarded by nothing.

The honest summary is therefore: **Cave's half is gate-quality. The gate is not closeable
from here.**

---

## Acceptance criteria → evidence

The gate's criteria are the three on the bead card (#4906) plus its five blocking beads.

### 1. All Phase 2 beads are closed — ❌ **FAILS**

| Bead | Issue | Owner | State |
| --- | --- | --- | --- |
| `cave-mfcsz` | [#4834](https://github.com/OpenCoven/coven-cave/issues/4834) Cave canonical read projections and routes | Cave | **CLOSED** — shipped in #4856, referenced in #4850 |
| `cave-g9d49` | [#4835](https://github.com/OpenCoven/coven-cave/issues/4835) Coven Rust session and event read APIs | Coven | **CLOSED** — `OpenCoven/coven#783`, squash-merged `83443a55` |
| `cave-3yax4` | [#4836](https://github.com/OpenCoven/coven-cave/issues/4836) SDK read clients, pagination, CLI output | SDK | **OPEN** |
| `cave-ff3j6` | [#4837](https://github.com/OpenCoven/coven-cave/issues/4837) Chat shell, filters, search, canonical transcript | Chat | **OPEN** |
| `cave-hjy2f` | [#4838](https://github.com/OpenCoven/coven-cave/issues/4838) Real-authority canonical read conformance | Cross-repo | **OPEN** — Cave third recorded, SDK and Chat thirds outstanding |

The blocking prerequisite [#4841](https://github.com/OpenCoven/coven-cave/issues/4841) —
the proxy pre-authorizing thirteen client-v1 paths with no handler behind them — is
**CLOSED**, and `CLIENT_V1_AUTHENTICATED_PATHS` (`src/proxy-helpers.ts:322-328`) now lists
exactly the five paths that have a `route.ts` calling `requireScope`.

`#4838` staying open is deliberate rather than an oversight, and the reasoning on that
issue is right: its Work section says *"across Cave, SDK, and Chat"*, and closing it on a
third would overclaim two repositories' worth of work.

`#4834`'s stated purpose was to make an advertisement true — `CLIENT_V1_CAPABILITIES` was
already publishing `familiars`, `projects`, `conversations`, `conversation-messages` and
`cursors` before any of them had a handler. It now lists exactly eight capabilities
(`contract.ts:48-57`), every one of them served, and the conformance run's
`health.live-inventory` compares the live inventory — order included — against the
generated `contract-fixture.json`, so the advertisement and the surface cannot drift apart
silently. #4882 made that check operational rather than declarative.

### 2. No second conversation database or browser canonical storage exists — ✅ **for this surface**, ⚠️ **one adjacent surface keeps structure the server does not**

See *Second-store audit* below.

### 3. Real Cave and Coven read journeys pass — ✅ **for Cave**, ⚠️ **Coven by proxy only**

Cave: `scripts/client-v1-conformance.mjs` against a release build over a real socket —
**105 assertions, 105 passed, 0 failed, 0 skipped**, with `--include-ttl`. Recorded at
`docs/client-v1-conformance-results/2026-08-23-v0.3.9-win32-cave-ma00l.json`.

Coven: the daemon read APIs are closed on their own lane (`OpenCoven/coven#783`), but this
run does not drive the production daemon — `/familiars` is served from a loopback fixture
daemon in hub mode, which is the first entry in the record's own `notCovered` list. So
"real Coven read journeys pass" rests on that repository's evidence, not on this one's.

---

## The conformance run

Taken per `docs/workflows/client-v1-conformance.md` on a clean tree, at commit
`87ebf7802`, against `pnpm build` output — never a dev server, and never the operator's
real `~/.coven` (the harness mints a temp `COVEN_HOME`/`COVEN_CAVE_HOME` under the system
temp dir, binds ephemeral loopback ports, and tears the tree and the server down by PID).

```
client-v1-conformance: passed (105 passed, 0 failed, 0 skipped)
client-v1-conformance: evidence written to docs/client-v1-conformance-results/2026-08-23-v0.3.9-win32-cave-ma00l.json
```

The assertion count moved 104 → 105 against the previous record
(`2026-08-23-v0.3.9-win32-cave-wbxcu.json`); `harness.assertion-coverage` requires every
declared id to be recorded exactly once, so the movement is an addition and not a drop.

Two things in that run are worth naming here because they answer questions the unit suites
leave open:

- **`reads.messages-reconcile-required`** actually moves `activeLeafId` to the abandoned
  branch between requests and then follows the client's cursor, rather than hand-minting a
  cursor against a static transcript. `reads.messages-restart-after-reconcile` then proves
  the recovery path. The unit-level test only pins the 409's *shape*.
- **Twelve mid-walk cases** on `/conversations` — touch-unserved, touch-served,
  touch-the-cursor-row, created-mid-walk, deleted-mid-walk, tied sort key, keyless rows,
  a keyless row written mid-walk, a keyless row that acquires a key between walks, and a
  row that becomes unreadable and then readable again. This is the surface where
  `cave-fhjlu` (a silent skip under a mutable `updatedAt` page key) was found, and it is
  now the most heavily exercised part of the read surface.

The record's `notCovered` is unchanged from the previous two and is the honest boundary of
this evidence: the SDK and Chat halves of #4838, the production Coven daemon, a genuinely
remote peer, the write scopes (there are no write routes to enforce them against), the
OAuth/consent UI, and cross-process pairing state.

---

## Mutation matrix

A gate that only checks *"is there a test mentioning this?"* is the failure mode this
repository has hit repeatedly — most sharply on this very surface, where the conformance
harness's `checkRecordShape` compared key sets and never values and so passed 89/0 against
a server returning `cat ~/.ssh/id_ed25519` as a field value. So every criterion below was
checked by breaking the behaviour and requiring the test to fail.

Forty-three mutations across `pagination.ts`, `reads.ts`, `read-guard.ts` and the five
route modules. Two no-op controls were included and correctly survived, so a `CAUGHT`
verdict is not the harness failing everything.

### Caught on the first pass (36)

| # | Mutation | Caught by |
| --- | --- | --- |
| M1 | `hasMore` always true | pagination · conversations |
| M2 | over-fetch removed (`limit+1` → `limit`) | pagination · conversations |
| M3 | keyset resume inclusive (`> 0` → `>= 0`), repeating the cursor row | pagination · conversations |
| M4 | non-canonical cursor encoding accepted | pagination |
| M5 | cursor version unchecked | pagination |
| M6 | `limit` ceiling lifted | pagination · conversations |
| M7 | `limit` spelling parsed with `Number` (`1e2`, `" 10"`) | pagination |
| M8 | comparator coercion removed (restores the cyclic order) | pagination |
| M9 | unresolvable sequence cursor restarts at 0 instead of refusing | pagination · messages |
| M10 | `assertMintableKey` disabled | pagination |
| M11 | recency tiebreak dropped | pagination · reads · conversations |
| M12 | conversation page key back to `updatedAt` (the `cave-fhjlu` bug) | reads · conversations |
| M13 | project page key to `updatedAt` | reads · projects |
| M14 | message projection leaks `tools` and `reasoning` | reads · messages |
| M15 | `requiredText` permissive | reads |
| M16 | `requiredRole` permissive | reads |
| M17 | transcript sequence ignores the active branch | reads · messages |
| M18 | `requiredId` allows the empty string | reads |
| M19 | familiars sorted descending | reads · familiars |
| M20 | unsupported query parameter accepted | read-guard |
| M21 | repeated query parameter accepted | read-guard |
| M22 | single-record route ignores query parameters | read-guard · conversation detail |
| M23 | bearer accepted from a bare `Authorization` header | read-guard |
| M24 | auth failure not metered against a bucket | read-guard |
| M25 | conversations route drops the scope check | conversations · authenticated-route-refusal |
| M26 | conversations route drops the loopback check | conversations · authenticated-route-refusal |
| B1 | cursor length ceiling lowered by 200 | pagination |
| B2 | spurious `next` on a full final continuation page | conversations |
| B8 | `runtime`'s path duplicated into `origin` | reads |
| B9 | `invalid_request` `details` emptied | read-guard |
| B10 | messages route ignores the `limit` ceiling | messages |
| C1b | cursor length ceiling raised by 200 | pagination |
| C3 | messages route lets a store throw escape | messages |
| C5 | familiars route swallows a bad query | familiars |
| C6 | conversations route swallows a bad query | conversations |
| C7 | conversation detail route swallows a bad query | conversation detail |

### Survived — every one a test gap, none a code defect (7)

The shipped code is correct in all seven. What was missing was the evidence.

| # | Mutation | Why nothing caught it |
| --- | --- | --- |
| B3 | **projects route swallows a malformed query** and serves the default page instead of a 400 | The route had no query-refusal test at all. Every other list route had one. The shared `parseClientV1ReadPage` is thoroughly unit-tested — but "the helper refuses" is not the claim "this route calls the helper". |
| B4 | **messages route swallows a malformed query** | Same shape. This is the one canonical read whose page cost scales with how much was said, so an unenforced ceiling matters most here. |
| B5 | **projects route lets an unprojectable row or a throwing store escape** as a non-envelope Next error page | The conversations list route had both tests; projects had neither. |
| B6 | **familiars route** — same | The roster is an unschema'd daemon HTTP response, so a renamed field reaching the projection is ordinary, not exotic. |
| C2 | **conversation detail route** — same | |
| B7 | **`factory.length` undercounts dependencies behind a default parameter** | `authenticated-route-refusal.test.ts` derives its tripwire count from `factory.length`, which stops counting at the first defaulted parameter. Giving a route's `sources` a default installs **zero** tripwires, hands the route its real production sources, and makes every *"nothing was consulted before the credential settled"* assertion pass against an empty list. The mechanism silently becomes a no-op. |
| C1 | **cursor length ceiling refuses a token exactly at the budget** | The budget-boundary case encoded a 120-character sort key and asserted only `<= 512`. That token is ~180 characters, so the test's own comment — *"the budget boundary itself is admissible, not merely one below it"* — was a claim it did not make. Moving the check to `cursorCharacters - 200` left it green. |

B7 and C1 are the `cave-gbqwe` class the brief names: state is seeded, the interesting
boundary is set up, and then something trivial is asserted. C1 is the clearer of the two —
a comment asserting a property the code below it does not test.

### After repair

All seven, re-measured against the repaired suites: **caught**. Two additional mutations
in the same neighbourhood (`C1b`, the ceiling raised rather than lowered; `B2`, a spurious
`next` on a full final continuation page, previously caught only incidentally at the
conversations route and not by the primitive itself) are now caught at the unit layer too.
A no-op control still survives.

No source file was modified. `git diff` for the repair commit touches six `*.test.ts`
files and nothing else — which is the strongest single statement this gate can make about
the surface: forty-three attempts to break it found nothing to fix.

---

## Weak assertions found but not repaired

Named here rather than fixed, because each is already backed by a stronger assertion
elsewhere and rewriting them would be churn:

- `reads.test.ts:60` — `deepEqual(Object.keys(projected).sort(), [...])` checks the key
  set and never a value. Masked by the full-object `deepEqual` at `:38`.
- `familiars/route.test.ts:220` — `assert.notEqual(body.error.details, undefined)` checks
  that a field is *defined*, never its value; a route answering `details: {}` passes.
  Masked by `read-guard.test.ts:143`, which asserts the reason names the offending
  parameter. The new projects and messages refusal tests assert the value directly.
- `authenticated-route-refusal.test.ts:246` — `assertRefused` asserts set membership
  (status ∈ {401, 403} **and** code ∈ {`unauthorized`, `scope_denied`}), so a route
  answering 403/`scope_denied` to a request carrying no `Authorization` header at all
  would pass. The pairing is not pinned per-probe.
- `authenticated-route-refusal.test.ts:536-548` — the positive control passes when the
  outcome is `threw` or "not a response". It proves *not a refusal*, not *reached the
  handler body*. Documented as intentional in the file.
- Four of the five conversations walk tests discard `walk.statuses` entirely.
- `scripts/client-v1-conformance.mjs` — `familiar`, `credential`, `pairingRequest` and
  `pairingStatus` records go through `checkRecordShape` (keys) with no `checkRecordValues`
  call. `project`, `conversation` and `message` records get both. That is the residue of
  the 89/0 defect, narrowed but not eliminated.
- `scripts/client-v1-doc-contract.test.mjs` pins routes, operations, scopes, capabilities
  and the error-code→status table against real code and the generated fixture — but **not**
  the doc's projection field lists. `docs/api/client-v1.md`'s withheld-field prose and the
  harness's hand-maintained `RECORD_SHAPES` table can drift apart with nothing failing.

---

## Second-store audit

Criterion 2 asks that no second conversation database and no browser canonical storage
exists.

### No second conversation database — holds

- The five client-v1 read routes take their stores through one injectable seam
  (`src/lib/server/client-v1/read-sources.ts`) bound to `cave-conversations.ts`,
  `cave-projects.ts` and the familiar roster. There is no second read path, and the route
  modules import nothing else.
- `src/lib/search-index-store.ts` (SQLite/FTS5) is **derivative by construction** — its
  header states every row is rebuildable from an authoritative source, which is why a
  corrupt database is quarantined and recreated rather than repaired. Two facts beyond the
  comment: the sessions provider indexes metadata only, never turn text
  (`search-indexed-providers.ts:238-245`), and `openSearchIndex` has no production caller
  at all today (`/api/search` passes `providers: []`).
- `~/.coven/coven.sqlite3`, the Coven daemon's own database, is foreign, opened
  `readOnly: true`, and deliberately excluded from backup as disposable
  (`backup-manifest.ts:96-99`).
- `~/.openclaw/agents/<familiarId>/sessions/<sessionId>.jsonl` is a genuine second on-disk
  transcript store, but it belongs to the harness: Cave only reads it, only as a fallback
  when the ledger has no record, and only from `/api/chat/conversation/:id`. **It is not
  reachable from any client-v1 route** — `/api/client/v1/conversations/:id` reads the
  ledger on purpose, because `status` and `exitCode` are derived while the ledger is built.

### No browser canonical storage — holds for this surface and for 1:1 chat; group chat is a partial exception

The Cache API is explicitly out (`public/sw.js` returns early for any `/api/` path and
its header names chat sessions as not cached), and IndexedDB holds only images.

**Group chat is the exception, and it is narrower than it first looks.** Every settled
coven reply — and the user's prompt — is POSTed to `/api/chat/send` with the coven's
per-familiar `sessionId` (`group-chat-view.tsx:810-819`), and that route writes an
ordinary conversation file per familiar into `<caveHome>/conversations/`. So the *text* is
on disk and is served by the canonical reads like any other conversation.

What is browser-only, in `cave:group-chat:groups:v1` and
`cave:group-chat:transcript:<groupId>` (`group-chat.ts:16`), is the **structure**: the
coven's identity and membership, speaking order, response mode, the map linking a coven to
its per-familiar conversation ids, and the transcript's assembly — which reply answers
which turn, delegation lineage, per-reply status and cost — plus the user's text as typed
rather than as wrapped in the roster framing, and anything past `TRANSCRIPT_CAP = 200`.
There is no `/api/coven` route to persist any of it.

Clearing that key does not lose the replies; it loses the ability to read them *as a
group*, leaving N orphaned 1:1 conversations. That is an index loss rather than a content
loss — but it is not covered by backup either, and `backup-manifest.ts:110-112` describes
what browser state it omits as *"localStorage preferences"*, which is not what a coven
definition is.

So: criterion 2 holds for the canonical read surface this gate is about. Whether group
chat's structure counts as "browser canonical storage" for Chat v1 is a program question,
and it is recorded here rather than decided.

---

## What would close the gate

1. `cave-3yax4` (#4836) — SDK read clients. Note that the account working this program is
   pull-only on `OpenCoven/sdk`, so it needs a fork PR.
2. `cave-ff3j6` (#4837) — the Chat shell.
3. `cave-hjy2f` (#4838) — the SDK and Chat halves of real-authority conformance. The Cave
   half is recorded and the harness is reusable as a model; what it cannot do is drive
   another repository's client.

Cave-side, nothing is outstanding for this gate.
