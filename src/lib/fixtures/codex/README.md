# Codex JSONL fixtures

## 0.160.0 qualification proposal

`0.160.0-tool-lifecycle.jsonl` records a real `codex-cli 0.160.0` turn on
2026-10-03. The CLI ran in a temporary project with an unpredictable marker
file, using:

```sh
codex exec --json --sandbox read-only --ephemeral --skip-git-repo-check --color never -- '<controlled read-only prompt>'
```

The prompt requested exactly one `cat marker.txt` and the marker as the final
answer. Both native output and answer matched. The process exited with code 0,
and its owned process group was verified gone. The capture used the existing
account's authentication and CLI configuration; HOME was not isolated.

The fixture preserves all eight events and their order. Sanitization replaced
the thread ID, unpredictable marker, and two nonfatal diagnostic messages.
Stderr was not retained in the fixture. Its SHA-256 is
`208f6890c02c115168dadbe68fcae9bb26172a61dc92a88529eb88f04357f156`.
The real turn contains one command start/completion pair and no reasoning item
or model identity field. Summary tests are separate synthetic contract cases.

`0.160.0-schema-proposal.json` is an unsigned, inactive proposal for
`>=0.160.0 <0.161.0`. Tests supply it directly to qualify the parser; production
does not load it. It must not be copied into a trusted cache or used to bypass
signature verification. Normal runtime resolution still rejects 0.160.0 until
the canonical owner reviews and admits a signed compatibility update.

The source contracts were read at tag `rust-v0.160.0`:

| Primary source | Git blob |
| --- | --- |
| [Rust event producer types](https://github.com/openai/codex/blob/rust-v0.160.0/codex-rs/exec/src/exec_events.rs) | `06565c097b28d3bf2ad592943cc30c776b45e236` |
| [TypeScript item types](https://github.com/openai/codex/blob/rust-v0.160.0/sdk/typescript/src/items.ts) | `8fd3b2c7ff5b47da5f64b16828e03c75c5e60961` |
| [TypeScript event types](https://github.com/openai/codex/blob/rust-v0.160.0/sdk/typescript/src/events.ts) | `f6ad902779bee05ab0fb9b9cc6a2bca59d52c136` |

The Rust contract includes collaboration tools and command `declined` status,
which the SDK item list omits. The proposal includes all five Rust tool item
types. `item.completed` carries terminal success or failure; the producer does
not declare an `item.failed` event. Error items are nonfatal notices, while
`error` and `turn.failed` are fatal events. Both Rust and SDK designate
`reasoning.text` as a summary; only completed summaries are projected.

This capture proves native command events exist. It does not qualify all five
tools, summary generation, resolved model reporting, or the Cave route. The
separate live Cave canary still selects its unsupported-version fallback and
receives no tool events. After canonical admission, rerun the route canary and
compare live events, replay, and history before claiming 0.160.0 support.
