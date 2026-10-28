# Runtime capability matrix refresh — 2026-10-28

This packet supports [#5763](https://github.com/OpenCoven/coven-cave/issues/5763)
and is the input [#6071](https://github.com/OpenCoven/coven-cave/issues/6071) and
the [#5767](https://github.com/OpenCoven/coven-cave/issues/5767) rerun asked for.
It replaces the stale 2026-10-18 matrix as the current inventory. It records
synthetic fixture coverage and a passive launch inventory at main source
`206d7fb613d976a1c7a65c32fdcc78c7ca642880`. **No real-provider turn, daemon
start, trust publication or support promotion happened.** Real-provider
receipts quoted here are historical and build-bound.

## Files

| File | Contents |
| --- | --- |
| [runtime-matrix.json](runtime-matrix.json) | Passive, credential-free launch inventory from `scripts/runtime-activity-runtime-matrix.mjs` (schema 2: adds Claude, Copilot and local-Codex rows, plus declarative SSH, Coven relay and OpenClaw entries) |
| [capability-matrix.json](capability-matrix.json) | One row per claimed runtime/path: a `status` of `passes` / `unverified` / `unsupported` / `deferred`, installed version, schema, reported activity, the seven #5763 criteria with `covered` / `partial` / `none` / `n/a`, evidence references, the missing input, owner and next step |

## What the inventory found on this host

| Runtime | Installed | Path | Schema | Diagnostic |
| --- | --- | --- | --- | --- |
| Codex (and codex-ollama, codex-lmstudio) | 0.164.0 | coven-fallback | none | `unsupported-version` (bootstrap admits 0.144.2 ≤ v < 0.146.0) |
| Claude | 2.1.312 | coven | `claude-stream-json-v2` | none; reasoning stays `unknown` |
| Copilot | 1.0.103 | direct-jsonl | `copilot-jsonl-v1` | none; reasoning `unsupported` |
| OpenCode | not installed | direct-cli | none | `capability-probe-unavailable`; read-only refused with 501 |
| Grok | not installed | — | none | no executable; no compatible schema under stock trust |
| Hermes | n/a (API) | api | `hermes-responses-v1` | fixture-only; served model unverified |

## Status per claimed path

Each path has exactly one status: **passes** (all seven criteria covered by
route-level fixtures with synthetic upstream traffic), **unverified**,
**unsupported** or **deferred**. "Passes" is a fixture claim, never a
real-provider qualification.

| Path | Status | Criteria covered at route level | Blocking input |
| --- | --- | --- | --- |
| Claude · Coven relay | **unverified**; reasoning `unknown` by design | 5; others partial | Runtimes descriptor (summary vs progress); canary authority |
| Claude · SSH relay | **unverified**; activity `ssh/unknown/unknown` asserted | 2, 5, 7 | registered host |
| Copilot · direct JSONL | **unverified**; reasoning `unsupported` | 5; others partial | canary authority |
| Codex · direct JSONL | **unverified**; fixtures cover admitted versions only, installed 0.164.0 unadmitted | 7; others partial | signed ≥ 0.146 admission (publisher key, endpoint, checkpoint) |
| Codex · Coven fallback | **unsupported** for activity by design; `coven/unknown/unknown` asserted | 2, 5, 7 | none claimed |
| Codex · Ollama / LM Studio | **unverified** (launch/preflight only, #6088) | none | Codex admission first |
| Hermes · Responses API | **passes** at route level; real provider unverified | 1–7 | served-model report; canary authority |
| Hermes · direct CLI | **unsupported** for activity; asserted `direct/unsupported/unsupported` | 2, 5, 7 | none |
| OpenCode · direct CLI | **unverified**; read-only unsupported (501 asserted) | 7; others partial | Val's Full-access decision |
| Grok · direct CLI | **unverified**; SSH refused (asserted) | 7; others partial | signed ACP admission |
| OpenClaw | **deferred** per #4892; SSH refused (asserted) | 7 | not under #5763 |

Hermes over the Responses API is the only path that passes all seven criteria
at route level, and the only one with a vertical-slice fixture that includes a
second summary. Every other claimed path is explicitly unverified, unsupported
or deferred. Claude thinking is `unknown` everywhere until a Runtimes
descriptor says whether it is a summary or progress; see
[the descriptor proposal](../../claude-reasoning-display-descriptor-proposal.md).

## Fixtures added in this packet

`src/app/api/chat/send/route-launch-path-activity.integration.test.ts` runs the
real send route against deterministic stand-in binaries and proves eight
behaviours the sibling `harness-routing-*.test.ts` files only regex-matched:

- Claude on the local Coven relay reports `coven/supported/unknown`, carries
  the probed CLI version, and manufactures no reasoning block.
- Codex 0.164.0 stays on the Coven relay with exactly one
  `codex-compatibility` notice (`unsupported-version`), `coven/unknown/unknown`
  and no launch version.
- Hermes on the direct CLI without an endpoint reports
  `direct/unsupported/unsupported`.
- The SSH relay reports `ssh/unknown/unknown`, no local version, and only the
  ssh transport runs.
- Read-only over SSH, Grok over SSH, OpenClaw over SSH and OpenCode read-only
  are each refused with 501 before any runtime process starts.

`route-copilot-identity.integration.test.ts` additionally asserts
`direct/supported/unsupported`, the `running → ok` lifecycle of the native call
id, and that a full message after its deltas does not duplicate prose.

`src/app/api/chat/send/route-hermes-boundaries.integration.test.ts` closes
criterion 7 for Hermes with two local HTTP fixtures (a redirecting endpoint and
the target it points at):

- Read-only is refused with 501 on the Responses API and on the direct CLI
  before any request leaves Cave or any process starts.
- A redirecting endpoint fails the turn: one request reaches the configured
  endpoint, the target is never contacted, the done frame is an error, the only
  assistant text is the existing withheld-diagnostic notice, and neither the
  bearer key nor either address appears in the stream, ordinary logs or saved
  history. The activity claim stays `api/supported/supported`.
- Hermes over SSH ignores the local endpoint and key: only the ssh transport
  runs, nothing is sent to the configured URL, and the key is absent from argv.

Red evidence: with the route's SSH activity path changed to `coven`, the SSH
case fails and the other seven pass; with the OpenCode read-only refusal
disabled, the OpenCode case fails and the other seven pass; with the Hermes
fetch changed from `redirect: "error"` to `"follow"`, only the redirect case
fails; with the Hermes read-only refusal disabled, only the two read-only cases
fail. The route was restored and is unchanged in the delivered diff.

## Commands

```sh
node --experimental-strip-types --import ./scripts/test-alias-register.mjs \
  scripts/runtime-activity-runtime-matrix.mjs --execute \
  "$PWD/docs/design/evidence/runtime-activity-2026-10-28/runtime-matrix.json"

node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types \
  --import ./scripts/test-alias-register.mjs \
  src/app/api/chat/send/route-launch-path-activity.integration.test.ts

node --require ./scripts/css-source-contract-hook.cjs --experimental-strip-types \
  --import ./scripts/test-alias-register.mjs \
  src/app/api/chat/send/route-hermes-boundaries.integration.test.ts
```

The inventory used a scratch `COVEN_HOME`; `~/.coven` was not read or modified.
Suite results (`pnpm check:tests-wired`, `pnpm typecheck`, `pnpm lint`,
`pnpm test:api`, `pnpm test:conformance`) are recorded on the PR and on #5763.

## Still missing, by owner

| Input | Owner | Unblocks |
| --- | --- | --- |
| OpenCode Full-access canary decision (pending since 2026-10-03) | Val | OpenCode qualification |
| Publisher key, endpoint and checkpoint for signed Codex ≥ 0.146 and Grok 1.0.46 ACP admission | Val | Codex direct and Grok structured paths |
| Review of the Claude descriptor proposal and permission to file it upstream | Val / Coven Runtimes owner | Claude reasoning leaving `unknown` |
| Per-run authority for `scripts/runtime-activity-canary.mjs --harness <claude\|codex\|copilot\|opencode> --execute --http` | Val | Current-candidate provider receipts |
| A registered SSH host for relay qualification | Val | SSH rows leaving `unverified` |
