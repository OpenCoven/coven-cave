# Exporting Coven familiar runs to Hermes Flight Recorder (HFR)

[Hermes Flight Recorder](https://github.com/zwright8/hermes-flight-recorder) turns
autonomous-agent execution traces into verifiable evidence: it normalizes a trace
to its internal `hfr.trace.v1` schema, scores it against scenario contracts
(forbidden commands/URLs, secret patterns, budget caps, assertions), and emits
scorecards, task-completion verdicts, and regression scenarios.

HFR ingests **observer-hook JSONL** — one JSON event per line, from the vocabulary
`session · pre_tool_call · post_tool_call · post_llm_call · subagent_start ·
subagent_stop · final_answer`. This exporter produces exactly that stream from a
Coven familiar's run history, so a familiar's work can be evaluated in HFR.

## Why the conversation file is the source

A Coven Cave conversation file (`$COVEN_HOME/cave/conversations/<sessionId>.json`)
is the richest self-contained record of what a familiar actually did: every tool
call with `input`/`output`/`status`/`durationMs`, per-turn token `usage` and
`costUsd`, and the assistant's answers. That maps cleanly onto HFR's observer-hook
events without needing the live daemon.

## Usage

```bash
pnpm hfr:export                          # every conversation → stdout (JSONL)
pnpm hfr:export --familiar cody          # only cody's runs
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
| `--max-field-chars <n>` | cap free-text fields; tool results keep their tail, `0` disables |

Then hand the JSONL to HFR's normalizer / scenario runner.

## Event mapping

| HFR event | Coven source | Notes |
|-----------|--------------|-------|
| `session` | conversation header | `session_id`, `source_format`, `familiar_id` (eval scope), `harness`, `model` |
| `user_message` | `role:"user"` turn | |
| `pre_tool_call` / `post_tool_call` | `turn.tools[]` | shared `call_id = tool.id`; `is_error` true for `error` **and** unresolved `running` tools; `post.ts = pre.ts + durationMs` |
| `post_llm_call` | `turn.usage` / `turn.costUsd` | tokens snake-cased for HFR; omitted when the harness reported neither |
| `subagent_start` / `subagent_stop` | `--subagents` links | only edges whose `parentSessionId` is this session |
| `final_answer` | last assistant turn | skips `cancelled`/`isError` turns |

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
- **Redaction.** Sensitive daemon events are already redacted upstream; HFR's own
  secret-scan policy runs on the exported text downstream. Field names track
  HFR's observer-hook contract and are centralized in `hfr-trace-export.ts` for a
  single-file reconcile once HFR's schema is pinned.
