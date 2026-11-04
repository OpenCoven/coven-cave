# Runtime canaries — 2026-11-04

Supports [#6071](https://github.com/OpenCoven/coven-cave/issues/6071). These are
the first real-provider receipts on this candidate. They add to the fixture map
in [runtime-activity-2026-10-28](../runtime-activity-2026-10-28/README.md) and do
not replace it. **No row is promoted.** A read-only marker turn does not qualify
a path, and all three strict script results are `passed: false`.

## Candidate and authority

| | |
| --- | --- |
| Source | `51ea27f663aeabda196adc142700a43282893a19`, no local patch |
| Hosted CI | Run 41773524472, attempt 1, 23/23 jobs success |
| Build | `59vw5PXSReKgWPSFiMgvN` (digests in [canary-receipts.json](canary-receipts.json)) |
| Coven | v0.4.10 (engine coven-code 0.8.0) on scratch `COVEN_HOME`; `HOME` not isolated |
| Authority | Val, directly in the session on 2026-11-04, once each. Five provider turns, no retries |

Val chose this head as "main after #6384 is green". It replaces `58f015cd9` for
these canaries. Receipts bound to `58f015cd9` stay bound to it.

## Results

| Runtime | Transport and client | Turns | Backend result | Rendered web client | Strict result |
| --- | --- | --- | --- | --- | --- |
| Codex 0.166.0 | Coven fallback, HTTP only | 1 | Answer has the marker; no native tool output; identity `coven/unknown/unknown`, no version or model | Not exercised | `passed: false`, expected: `unsupported-version` |
| Claude 2.1.318, `claude-opus-5-5` | `claude-stream-json-v2`, Coven relay, HTTP and web | 2 | HTTP turn: tool, history and replay all match. Interactive phase failed at its first `snapshot` | Read tool, identity and unavailable reasoning shown. Answer text altered (below). Not checked after reload | `passed: false`, 404 caused by the driver (below) |
| Copilot 1.0.103, `claude-sonnet-5.5` | `copilot-jsonl-v1`, direct, HTTP and web | 2 | HTTP turn and interactive `snapshot`, `restored` and `finish` all verified | `view` tool and identity shown, live and after reload. Answer text altered (below) | `passed: false`, `daemonStopped: false` (below) |

Each composer send was sent with `permissionMode: read`, confirmed by a request
guard, after `Explore · read only` was selected in the real composer.

## First failures, kept as they happened

- **Claude's interactive phase failed because of the driver, not the product.**
  The first driver waited 170 seconds for the exact marker in the rendered
  answer, which never appears (see the first finding). Finished runs leave the
  replay buffer after 2 minutes (`FINISHED_RETENTION_MS`), so `snapshot` ran about
  4 minutes after the turn and `/api/chat/stream` returned 404. The completed
  state was only seen by reopening the saved conversation, so there is no live
  completed capture and no reload check for Claude. It was not rerun: authority
  was once each.
- **Copilot's strict result is false on one check.** The script found the daemon
  pid alive right after `daemon stop`. Later, no such process existed and
  `coven daemon status` reported not running. A race is likely but not proven.
- **Codex failed as predicted.** That records a refusal, not support.

## Findings

1. **Rendered answers drop intraword underscores.** The saved answer and the tool
   output hold the exact marker, but the rendered answer shows `CAVE`, italic
   `ACTIVITY`, then the rest, with no underscores. This happens on the Claude and
   Copilot runs; on Copilot it was seen both live and after reload. It reproduces with no provider:
   `@create-markdown/core` 2.0.3 parses `set MAX_RETRY_COUNT to 3` the same way,
   and `file_a and file_b` also loses text. Inline code is unaffected. Fixtures did
   not catch this because they assert saved text rather than rendered text. Not
   fixed here.
2. **E2E shard 3 reports success with no sign of running tests.** `Frontend E2E
   (3/8)` logs no `Running N tests` line or summary on all 10 sampled green runs
   that had the job, 2026-11-02 to 2026-11-04. Cause not investigated.

Screenshots have scratch paths and the marker's random part masked; the visible
prefix shows finding 1.

| Capture | File |
| --- | --- |
| Copilot, live and completed | [copilot-web-live-completed.png](copilot-web-live-completed.png) |
| Copilot, after reload | [copilot-web-after-reload.png](copilot-web-after-reload.png) |
| Claude, reopened from the sidebar | [claude-web-reopened-completed.png](claude-web-reopened-completed.png) |

## Inventory at the candidate

[runtime-matrix.json](runtime-matrix.json) is the passive inventory at this head.
Since the 2026-10-28 packet, only versions changed: Codex 0.164.0 to 0.166.0
(still `unsupported-version`) and Claude 2.1.312 to 2.1.318.

## Still open

| Row | State | Needed |
| --- | --- | --- |
| Claude and Copilot, web | Unverified: read-only observation only; answer rendering defect open | Fix finding 1, then separately authorized reruns. Claude also needs a live completed capture and a reload check |
| Claude reasoning | `unknown` | Runtimes descriptor decision |
| Desktop and native clients | Unverified, not exercised | Separately authorized runs |
| Codex direct and local backends | Unverified | Signed ≥ 0.146 admission inputs |
| OpenCode, Grok | Unverified, not installed here; no install attempted | Val's Full-access answer; signed ACP admission |
| Hermes real provider | Unverified; no canary harness | Endpoint, served-model report, harness |
| SSH relay | Unverified | A registered host |
| OpenClaw | Deferred (#4892) | Nothing under this issue |

## Commands

```sh
node --experimental-strip-types --import ./scripts/test-alias-register.mjs \
  scripts/runtime-activity-canary.mjs --harness codex --execute --http

node --experimental-strip-types --import ./scripts/test-alias-register.mjs \
  scripts/runtime-activity-canary.mjs --harness <claude|copilot> --execute --http \
  --interactive-client web --interactive-evidence <new absolute directory>
```

The web client was driven by throwaway Playwright scripts, whose digests are in
the receipts. To repeat a run, deliver `snapshot`, `restored` and `finish` within
2 minutes of the turn ending. Stdin works through a FIFO fed by `tail -f` only if
each command is a separate write and close; a writer held open stalls delivery.
