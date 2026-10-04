# Exporting Coven familiar runs to Hermes Flight Recorder (HFR)

[Hermes Flight Recorder](https://github.com/zwright8/hermes-flight-recorder) turns
autonomous-agent execution traces into verifiable evidence: it normalizes a trace
to its internal `hfr.trace.v1` schema, scores it against scenario contracts
(forbidden commands/URLs, secret patterns, budget caps, assertions), and emits
scorecards, task-completion verdicts, and regression scenarios.

HFR ingests **observer-hook JSONL** — one JSON event per line, from the vocabulary
`session · user_message · pre_tool_call · post_tool_call · post_llm_call · subagent_start ·
subagent_stop`. This exporter produces that stream from a
Coven familiar's run history, so a familiar's work can be evaluated in HFR.

## Why the conversation file is the source

A Coven Cave conversation file (`$COVEN_HOME/cave/conversations/<sessionId>.json`)
is the richest self-contained record of what a familiar actually did: every tool
call with `input`/`output`/`status`/`durationMs`, per-turn token `usage` and
`costUsd`, and the assistant's answers. That maps cleanly onto HFR's observer-hook
events without needing the live daemon.

## Usage

```bash
pnpm hfr:export --session <id>          # one conversation → stdout (JSONL)
pnpm hfr:export --familiar cody          # must select exactly one conversation
pnpm hfr:export --session <id> --out trace.jsonl
pnpm hfr:export --subagents links.json   # splice in delegation edges
```

| Flag | Meaning |
|------|---------|
| `--dir <path>` | conversations dir (default `$COVEN_HOME/cave/conversations`) |
| `--session <id>` | export a single conversation |
| `--familiar <id>` | filter to one familiar (the eval scope) |
| `--subagents <path>` | JSON array of `{parentSessionId, childSessionId, familiarId?, status?, startedAt?, endedAt?}` |
| `--out <path>` | write JSONL to a file (default stdout) |
| `--source-format <str>` | override the session event's `source_format` (default `coven.cave.v1`) |
| `--max-field-chars <n>` | optional free-text clipping; tool results keep their tail, `0` disables clipping but not disclosure bounds |

Then hand the JSONL to HFR's normalizer / scenario runner.

## Event mapping

| HFR event | Coven source | Notes |
|-----------|--------------|-------|
| `session` | conversation header | `session_id`, `source_format`, `familiar_id` (eval scope), `harness`, `recorded_model`; the header model is historical context, not a per-turn native report |
| `user_message` | `role:"user"` turn | |
| `pre_tool_call` / `post_tool_call` | projected `turn.tools[]` | shared display `tool_call_id`; only `ok`/`error` results produce a post event; `post.ts = pre.ts + durationMs` |
| `post_llm_call` | valid assistant answer, usage, or cost | tokens snake-cased for HFR; `model` comes only from validated per-turn `runtimeIdentity.model` |
| `subagent_start` / `subagent_stop` | `--subagents` links | only edges whose `parentSessionId` is this session |

Assistant hooks retain `turn_id` and a validated `runtime_identity` when the
stored server metadata supplies one. That record preserves the exact harness,
version, model, and activity availability through runtime switches. Legacy
selected/forwarded/confirmed model fields do not become native identity. Missing
or invalid reports remain unavailable; the exporter does not fill them from the
conversation header. HFR's handling of these additional fields is not qualified
by Cave's exporter tests.

The last valid `post_llm_call.assistant_response`/`output` supplies the answer;
there is no separate `final_answer` event. Cancelled/error drafts are omitted.
Tool timestamps remain reconstructed from the turn start and recorded duration,
not authoritative execution timestamps. Exported observations do not establish
approval, a session lease, or a committed effect.

## Scope & follow-ups

- **Pure transform, tested offline.** All mapping logic lives in
  `src/lib/hfr-trace-export.ts` with `src/lib/hfr-trace-export.test.ts`; the CLI
  (`scripts/coven-hfr-export.ts`) is a thin I/O shell.
- **Delegation graph is fed, not derived.** The daemon's `cave-coven-calls`
  ledger records `callerFamiliarId → calleeFamiliarId` + the callee `sessionId`,
  but not the *parent* session id, so subagent edges are supplied explicitly via
  `--subagents`. Deriving them automatically is a follow-up once the ledger
  exposes the parent session.
- **Eval metrics.** `results.tsv` (`metric_before/after/delta/outcome` per track)
  is HFR's natural baseline-vs-candidate compare input; wiring it into an HFR
  compare export is a separate slice.
- **Disclosure.** Historical tool names, IDs, arguments, and completed results
  pass through the same projection as conversation reads before optional
  clipping. Credentials, common PII, signed URLs, and recognized opaque provider
  fields are filtered; unfinished tool output is withheld. Legacy thinking tags
  are removed from assistant answers. User-authored text and literal code
  examples remain intact. This is not exhaustive PII detection or an export of
  private execution state; stored records are not rewritten.
- **Downstream qualification.** Cave's local tests verify emitted JSONL and the
  CLI boundary. A pinned HFR normalizer/scorer run remains separate evidence.
