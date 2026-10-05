# Grok 1.0.46 qualification fixtures

These are local qualification inputs, not runtime admission or publisher output.
`1.0.46-unsigned-proposal.json` contains no signature and is not loaded by the
production resolver. Its exact-version binding does not include 1.0.5 or future
versions. The identical publisher proposal lives in Coven Runtimes
`examples/grok-compatibility-proposal.json`.

## Capture

On 2026-10-03 the installed 1.0.5 binary was rejected by xAI with HTTP 426:
minimum 1.0.13. The native updater reported stable 1.0.46; after preserving a
byte-verified rollback binary, the updater installed 1.0.46 (2765805b9442).
The resolved executable SHA-256 was
`e8daa302364c9c3b6a5546d511cfbd1ab5e5d407a9b04282f660665ea405f9f3`.

`1.0.46-help.txt` is the complete credential-free passive `--no-auto-update
--help` stdout (exit 0, no stderr), SHA-256
`cda6873e2f90a7d77de94c2e3026794671fac04b2e40ac74e4d91f429f829403`.

The native canary created a fresh marker-only project and UUID. It used
`--sandbox read-only --permission-mode dontAsk --tools read_file --deny MCPTool
--disallowed-tools Agent --no-subagents --disable-web-search --max-turns 4`,
an exact `Read(<project>/marker.txt)` allow rule, `GROK_MEMORY=0`, and no model
flag. It never resumed a session or changed saved access settings.

The CLI exited 0 with no stderr; the marker remained unchanged and was present
in both the native read_file result and assistant output. The child was reaped.
`1.0.46-tool-read.json` retains those three tool frames; call ID, marker, and
absolute scratch path are replaced with deterministic fixture values. No
thought, usage signature, account data, or unrelated tool catalog is retained.
The observed sequence is pending -> statusless location update -> completed.
A running phase is not inferred from the tool request or its location metadata.
Failure and in_progress unit cases are source-derived mutations, not additional
live native captures.

## Public producer evidence

The pinned [headless reducer](https://github.com/xai-org/grok-build/blob/2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8/crates/codegen/xai-grok-pager/src/headless/reducer/acp.rs)
and [status mapping](https://github.com/xai-org/grok-build/blob/2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8/crates/codegen/xai-grok-pager/src/headless/reducer/mod.rs)
match the captured field shapes. The [headless guide](https://github.com/xai-org/grok-build/blob/2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8/crates/codegen/xai-grok-pager/docs/user-guide/14-headless-mode.md)
describes this flat ACP-derived format. Their SHA-256 values respectively are
`a74d5d59feb45101a07ddd2263ae79a6272f120145aaffb7de95936091863cf4`,
`556b8cf95ed75d7199eb940d554abdd721ddc56edb527089939f60286f10993b`, and
`248d83a99ec6fbeb0443754b98cc195b3ab44168bf30a2f110e3188d4045f230`.

Neither installed binary's printed commit resolves in the public repository.
This is matching source evidence plus a native capture, not proven binary-to-
source reproducibility. The capture's end frame contains aggregate modelUsage;
its keys have not been qualified as the authoritative primary model identity.
The adapter therefore keeps reported model null.

## Admission boundary

The proposal introduces the data-only `toolLifecycle` event group. It maps
pending to requested, in_progress to running, and explicitly declared terminal
states to results. Statusless updates disclose no payload or execution state.
Existing event groups keep their semantics. Exact versions, named-call fields,
and state fields remain required. Event lists are bounded at 32 names; field
alias lists retain their bound of 8. Unknown events/states still fail closed.

Help that advertises ACP requires an exact-version schema, so fixing multiline
help parsing cannot accidentally select the unversioned legacy text baseline.
Production still needs a reviewed, canonically signed bundle and configured
publisher trust. Tests generate isolated ephemeral keys and caches only.
The live capture bypasses Cave for protocol qualification; the separate Cave
route test replays sanitized frames with an isolated signed fixture. Neither
constitutes a stock-trust live Cave/provider acceptance test.
