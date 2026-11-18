# Harness model catalog pipeline

Cave's historical model catalogs and context-window metadata come from
`config/runtime-model-catalog.json`. Do not hand-edit
`src/lib/runtime-model-catalog.gen.ts`.

## Updating catalog metadata

1. Add or update the model in `models`. Give each provider the exact bare model
   ID its harness accepts and record the full input context window when known.
2. Add the model key to every compatible entry in `harnesses.models`. This
   preserves legacy catalog metadata; it does not add a live menu choice or
   establish the runtime's default. A
   model whose availability depends on a CLI/provider probe must set
   `capabilityGated: true` and stay out of every static harness list.
3. Run:

   ```bash
   node scripts/sync-model-catalog.mjs
   node scripts/sync-model-catalog.mjs --check
   ```

4. Run the focused model tests:

   ```bash
   node --experimental-strip-types src/lib/runtime-models.test.ts
   node --experimental-strip-types src/lib/model-label.test.ts
   node --experimental-strip-types src/lib/context-meter.test.ts
   ```

5. Inspect the generated diff. Verify harness-native IDs, historical labels,
   and context metadata. Current picker membership must also be established
   through the runtime-backed selection path below.

`src/lib/runtime-models.test.ts` compares the generated module byte-for-byte
with the manifest, so the existing app test suite and CI reject stale generated
output. The generator also rejects unknown model references, duplicate
provider IDs, unknown fields, unsupported providers, unsafe IDs/defaults,
capability-gate bypasses, and missing provider projections.

## Runtime-backed selection

Selectable models come from the active runtime/provider inventory. A missing,
failed, or disallowed discovery returns no model choices; it never repopulates
an old static seed. Runtime default remains selectable and explicitly unresolved
until the runtime reports the model. Previously saved model IDs remain visible
as history or an out-of-inventory selection, without becoming offered choices.

Val's selection policy is **only the newest supported release in each family**.
`runtime-model-families.ts` compares numeric releases within each recognized
provider/family/variant. It preserves separate provider namespaces and custom
deployments. It does not establish model support: discovery does that first.
Hidden, deprecated, and migration-only Codex entries are omitted before grouping.

| Harness | Discovery used by the shared inventory endpoint |
| --- | --- |
| Codex | Scoped `app-server` initialization followed by paginated `model/list`, with hidden entries excluded. |
| Claude Code | Scoped stream-JSON control initialization; `models[].resolvedModel` supplies exact launch IDs instead of moving family aliases. |
| GitHub Copilot CLI | Account/policy-scoped `models.list`. |
| OpenCode | Authenticated `opencode models`. |
| Grok Build | Its existing local model discovery. |
| Hermes | Provider discovery for a validated bare-local API binding. |
| OpenClaw | Runtime-managed; no fabricated local model list. |

Codex and Claude inventory probes initialize only the control protocol. They do
not create a thread, submit a prompt, or run a tool. They use scoped environments,
a bounded 60-second cache, a maximum of four simultaneous discoveries, an
eight-second deadline, a two-MiB stdout limit, and process termination on completion
or failure. Codex pagination rejects repeated cursors and stops after 20 pages.
Remote/SSH Codex and Claude bindings cannot inherit this machine's local inventory.

The generated catalog is retained for historical labels, context metadata,
and compatibility checks. Those uses are separate
from support discovery and must not be presented as current account entitlement.
The old Claude version probe still governs the legacy Opus 5 alias launch check;
it is not the source for the shared model menu.

When adding a new Claude family name, update `src/lib/model-label.ts` too.
The catalog test rejects Claude entries that would render as an unrecognized
raw model ID.

## Current OpenAI model metadata

Verified on 2026-11-17: the local Codex inventory reports GPT-6.2 Sol, GPT-6.2 Astra, GPT-6.1 Terra and GPT-6 Luna. Their context metadata uses the full 1,050,000-token window documented for [Sol](https://developers.openai.com/api/docs/models/gpt-6.2-sol), [Astra](https://developers.openai.com/api/docs/models/gpt-6.2-astra), [Terra](https://developers.openai.com/api/docs/models/gpt-6.1-terra) and [Luna](https://developers.openai.com/api/docs/models/gpt-6-luna). When a turn omits its effective window, the meter shows an estimate using the observed Codex defaults of 500,000 tokens for Sol and Terra and 272,000 for Astra and Luna. A valid window reported with turn usage takes precedence. These entries remain capability-gated and absent from static harness seed lists; live account-scoped discovery determines availability and newest-family selection.
