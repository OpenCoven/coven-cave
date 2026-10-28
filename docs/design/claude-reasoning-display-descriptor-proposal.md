# Claude reasoning display descriptor: proposal to Coven Runtimes

**Status: review draft under [#5763](https://github.com/OpenCoven/coven-cave/issues/5763).**
This is Cave's request for a producer contract. It is not an accepted Runtimes
schema, an upstream filing, a runtime admission, or an implementation claim.
Filing it in the Coven Runtimes repository needs the launcher's authority; until
then it lives here so #5763, #6071 and #5767 cite one text.

## Why Cave needs it

Claude Code's `stream-json` envelope carries `thinking` and `redacted_thinking`
content blocks. The same native field can hold a provider summary, a progress
narration or omitted content, and nothing in the envelope says which. The
accepted Claude compatibility profiles (`claude-stream-json-v1`,
`claude-stream-json-v2` in `src/lib/runtime-compatibility.ts`) describe the
tool envelope only; they declare no display representation.

Cave therefore keeps Claude reasoning **metadata-only**. In
`src/lib/claude-stream.ts` a `thinking` block becomes a reasoning event with
`phase: "unavailable"`, and a `redacted_thinking` block adds
`unavailableReason: "provider-withheld"`. No text, signature or encrypted
continuation state enters the projection. `runtimeActivityForAdapter` reports
Claude reasoning as `unknown` on every launch path, and the 2026-10-28 passive
matrix records the same. A model name, a provider payload claim or a successful
process exit cannot change that state (#5763 invariant: no model-name
heuristics).

The result is honest but uninformative: readers see "Reasoning summaries: not
verified on this path" even when Claude emits displayable summaries. Only a
producer-owned descriptor can close that gap without Cave guessing.

## What the descriptor must say

The canonical Runtimes owner defines field names, publication and validation.
Cave asks for these semantics through the existing signed compatibility
mechanism, not a parallel registry:

1. **Launch-bound representation.** Bind one display representation to the
   reviewed runtime, protocol, version range and launch path, with the launch or
   negotiation evidence that proves it applies. Values: `summary`, `progress`,
   `omitted`, `unknown`. A model family, a payload assertion, a tool-profile
   source URL or a process exit code is insufficient evidence.
2. **Display field and unit boundary.** Name the provider-designated display
   field (today `thinking` on a `thinking` block) and what constitutes one
   complete unit. Signatures, `redacted_thinking` data, encrypted continuation
   state and unrelated provider fields stay outside the display projection and
   remain byte-identical in their canonical runtime owner.
3. **Fail-closed rules.** Specify how missing, conflicting, unrecognized or stale
   launch evidence resolves. Cave keeps the current metadata-only behaviour in
   every such case without disabling independently valid sibling text or tool
   events in the same message.
4. **Fixture corpus.** Ship same-model fixtures for `summary` and `progress`
   plus omitted, redacted, unknown, forged display claims, partial units and
   opaque-state sentinels. Each fixture carries the exact descriptor identity,
   launch identity and schema version so a fixture pass is never mistaken for
   admission evidence.
5. **Trust preserved.** Keep signature, expiry, rollback and publisher-trust
   validation as for tool profiles. Accepting a descriptor must not widen tool
   execution, protected authorization, access mode or supported launch paths.

## Cave consumer acceptance after upstream agreement

- Map only an admitted, launch-bound `summary` or `progress` classification to
  the existing `provider-summary` / `provider-progress` representation in
  `src/lib/chat-reasoning-blocks.ts`. `omitted` and `unknown` stay
  `unavailable`; `redacted_thinking` keeps `provider-withheld`.
- Route complete display units through `ReasoningBlockTracker` and
  `projectReasoningText` in `src/lib/server/chat-reasoning-projection.ts`
  before SSE, replay retention, transcript storage and logs. Keep the existing
  bounded-length and redaction behaviour.
- Retain request, run and attempt correlation and the current
  `binding: "unavailable"` authoritative-session state.
- Prove identical representation and disclosure on live, replay and history for
  web and native clients on the nominated #5767 candidate. Withheld and
  unknown blocks remain content-free; opaque bytes never appear in SSE,
  previews or ordinary logs; no replay re-dispatches a tool.
- A direct-path receipt qualifies the direct path only. Coven relay and SSH
  need their own receipts; SSH cannot borrow a local descriptor.

Until that acceptance, Claude reasoning stays `unknown` in the matrix and the
UI. The default-on reasoning preference and explicit opt-out from #5454 are
presentation only and are unchanged by this proposal.

## Unresolved inputs

| Input | Owner | Needed for |
| --- | --- | --- |
| Descriptor decision and field contract | Coven Runtimes owner | Any representation other than `unknown` |
| Launch evidence the producer can expose | Coven Runtimes owner | Launch-bound classification |
| Review of this draft and permission to file it upstream | Val | Turning this document into a Runtimes PR |
| Real-provider Claude canary on the nominated candidate | Val, per run | Receipts after the descriptor is admitted |

Do not read or copy the preserved Runtimes proposal under `~/.coven`; it is a
separate owner-held artifact and is not an input to this document.
