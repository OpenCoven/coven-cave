# Release Acceptance — Three-OS Journey

Chat v1 Phase 7, Task 12. This runbook covers the acceptance journey an
operator executes on macOS, Windows, and Linux before a release is allowed to
begin a staged rollout, and the evidence format that makes "acceptance passed"
checkable rather than asserted.

Rollout is gated on it: `scripts/release-rollout.mjs` refuses to advance a
rollout whose acceptance summary is anything other than `complete`. See
[Production Rollout](production-rollout.md).

## What is and is not automated

The journey itself is manual by design. It installs published, signed artifacts
on real machines with no developer tooling present — that is the entire point,
and a CI runner with a source checkout cannot stand in for it.

What is automated is the *evidence*: `scripts/release-acceptance.mjs` validates
the record an operator produces, so a missing operating system, an unrecorded
step, a malformed checksum, or a leaked credential fails loudly instead of
passing as prose in a release issue.

```bash
pnpm release:acceptance steps                 # the journey, in order
pnpm release:acceptance template 1.0.0 > docs/release-acceptance-results/v1.0.0.json
pnpm release:acceptance validate docs/release-acceptance-results/v1.0.0.json
```

## Before starting

1. Build immutable release candidates from exact candidate tags through the
   signed workflows in [Branching](branching.md#release-and-testflight). Never
   re-cut a tag to fix a candidate; raise `rc.N`.
2. Record every artifact's SHA-256 into the record's `artifacts` array. These
   are the digests the acceptance ran against — a rollout that ships different
   bytes has not been accepted.
3. Confirm the prior stable release is still a viable rollback target before
   any acceptance begins. That verdict comes from the release workflow's
   rollback-readiness gate and is what
   [Production Rollout](production-rollout.md) consumes as
   `rollbackReadiness`.

## The journey

Run all of the following on **each** of macOS, Windows, and Linux, from a
machine with no developer tools and no source checkout.

| Step id | What the operator does |
| --- | --- |
| `install-cave` | Install a supported Cave build |
| `install-chat` | Install Chat with no developer tools present |
| `discover-cave` | Discover and start Cave from Chat |
| `pair-approve` | Pair the client and approve it in Cave |
| `load-lists` | Load familiar and conversation lists |
| `create-send` | Create a conversation and send a message |
| `disconnect-resume` | Disconnect and resume without message loss |
| `restart-history` | Restart both sides and verify canonical history |
| `attachment` | Upload an attachment and reopen it |
| `safe-action` | Confirm one safe action in a test repository |
| `revoke-pairing` | Revoke the client and return to pairing |
| `update-migration` | Update Chat and verify preference/keychain/cache migration |

Then the global CLI, installed from the published package rather than a
checkout:

| Step id | What the operator does |
| --- | --- |
| `cli-install` | Install `@opencoven/dev-cli` globally |
| `cli-doctor` | Run `opencoven doctor` |
| `cli-pair` | Pair the CLI against Cave |
| `cli-session` | Inspect Coven sessions |
| `cli-send` | Send a test conversation message |
| `cli-tail` | Tail that conversation |
| `cli-scaffold` | Execute every scaffold |

## The evidence record

Records live in `docs/release-acceptance-results/<tag>.json`. Every step takes
one of four results:

- `pending` — not attempted yet. This is what a fresh template is full of.
- `pass` — done.
- `blocked` — attempted, could not complete.
- `fail` — failed.

`blocked` and `fail` are outcomes an operator observed, so both must carry a
`diagnosticId`: a failure nobody can look up later is a note rather than a
diagnosis. `pending` owes nothing — an unattempted step is a gap in coverage,
not a defect.

```json
{
  "candidate": { "version": "1.0.0", "tag": "v1.0.0", "commit": "<40-hex>" },
  "artifacts": [{ "name": "CovenCave-v1.0.0-aarch64.dmg", "sha256": "<64-hex>" }],
  "runs": [
    {
      "os": "macos",
      "osVersion": "15.5",
      "caveVersion": "0.3.6",
      "chatVersion": "1.0.0",
      "cliVersion": "1.0.0",
      "steps": {
        "install-cave": { "result": "pass", "diagnosticId": "", "notes": "" }
      }
    }
  ]
}
```

The validator reports three states:

- **`complete`** — all three operating systems present, every step passed, and
  no structural problem anywhere in the file. This is the only state that
  unblocks rollout. A malformed digest or a mismatched tag therefore keeps a
  fully passed journey out of `complete`, deliberately: the record is a claim
  about *which bytes* were accepted, and a record that cannot say which bytes
  those were has not made it.
- **`failed`** — at least one step is recorded as a failure. The rollout gate
  treats this as a rollback decision: the candidate must not become the served
  update.
- **`incomplete`** — anything else. A missing OS, a missing step, or a step
  still `blocked`.

### Do not commit credentials

The record is committed to the repository, so the validator refuses
credential-shaped strings anywhere in the file and names the JSON path so it can
be redacted: GitHub PATs (classic and fine-grained), npm tokens, AWS access
keys, private-key blocks, Slack tokens, `Authorization: Bearer …` headers, and
`?token=`-style credentials in a URL.

The list is literal prefixes rather than an entropy heuristic, and that is a
deliberate trade. Every artifact digest and commit SHA in this record is a long
hex string, so an entropy rule would flag the evidence itself on every run and
be turned off within a week. The cost is real false negatives — an opaque
session cookie or a base64 blob with no recognizable prefix passes — so the
scan is a backstop, not the control. **Sanitize diagnostics before pasting
them**, and reference a diagnostic ID rather than its contents.

## Recording acceptance

Commit the validated record, then note in the release issue: the OSes covered,
the versions under test, the artifact checksums, the result, and the diagnostic
IDs for anything not `pass`. The commit is the durable record; the issue
comment is the pointer to it.
