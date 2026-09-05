# Harness model catalog pipeline

Cave's static model fallback catalogs and context-window metadata come from
`config/runtime-model-catalog.json`. Do not hand-edit
`src/lib/runtime-model-catalog.gen.ts`.

## Updating supported models

1. Add or update the model in `models`. Give each provider the exact bare model
   ID its harness accepts and record the full input context window when known.
2. Add the model key to every compatible entry in `harnesses.models`. Order is
   picker order; the first entry remains the Cave-owned fallback default. A
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

5. Inspect the generated diff. A model update is complete only when picker
   membership, harness-native launch IDs, runtime echo normalization, and
   context metadata are covered.

`src/lib/runtime-models.test.ts` compares the generated module byte-for-byte
with the manifest, so the existing app test suite and CI reject stale generated
output. The generator also rejects unknown model references, duplicate
provider IDs, unknown fields, unsupported providers, unsafe IDs/defaults,
capability-gate bypasses, and missing provider projections.

## Static seeds versus live discovery

The generated matrix is Cave's conservative fallback and cross-surface
contract. It does not claim account entitlement:

| Harness | Catalog behavior |
| --- | --- |
| Claude Code | Uses the generated Anthropic seed. Capability-gated additions such as Opus 5 may be prepended after a local CLI/provider probe. |
| GitHub Copilot CLI | Uses the generated GitHub seed only when account-scoped `models.list` discovery is unavailable. A successful live inventory replaces the seed and honors account policy. |
| OpenCode | Uses authenticated `opencode models` discovery and keeps an empty static list. |
| Grok Build | Uses live discovery where available and otherwise defers to its runtime default. |
| Codex and Hermes | Use their generated curated OpenAI lists; Hermes still leaves an unselected launch to the runtime. |
| OpenClaw | Owns model selection and keeps an empty static list. |

When a provider has not exposed bounded entitlement discovery, add a model to a
static seed only after confirming that the corresponding harness accepts its
bare ID. Keep runtime capability gates separate from the generated matrix when
support depends on CLI version, provider mode, or deployment mapping.

When adding a new Claude family name, update `src/lib/model-label.ts` too.
The catalog test rejects Claude entries that would render as an unrecognized
raw model ID.
