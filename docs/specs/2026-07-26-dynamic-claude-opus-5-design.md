# Dynamic Claude Opus 5 model support

## Goal

Expose Claude Opus 5 everywhere Cave can actually route it without turning a
release announcement into a stale static promise. One canonical Cave model id
must survive the web picker, iOS model-state API, task overrides, SSH routing,
and response metadata:

```text
anthropic/claude-opus-5
```

## Relevant runtimes

- **Claude Code:** capability-gated by the installed Claude Code version and
  provider configuration. Cave stores the canonical id and forwards the
  provider-portable `opus` selector. Claude's init frame remains the authority
  for what actually ran.
- **GitHub Copilot CLI:** discovered from the authenticated CLI's `models.list`
  JSON-RPC response. Cave never advertises an account- or policy-disabled
  model from a seed list.
- **OpenCode:** already discovered from `opencode models`; the work adds
  explicit Opus 5 parsing and routing coverage rather than a second catalog.
- **Codex, Hermes, and Grok:** do not expose Anthropic models through their
  current Cave contracts.
- **OpenClaw:** owns model selection behind its gateway and does not accept a
  Cave model override.

## Approaches considered

### 1. Add Opus 5 to every static list

Small, but incorrect. It would advertise a model to Claude Code versions before
2.1.219 and to Copilot accounts where rollout or administrator policy has not
enabled it.

### 2. Add the full Copilot SDK

Uses the official typed client, but also installs a second bundled Copilot CLI
plus a native FFI dependency. Cave already resolves and launches the user's
exact CLI. Pulling another runtime into the app would create version skew and a
large cross-platform dependency for one read-only RPC.

### 3. Shared capability resolver over installed runtimes

Selected. Cave keeps static catalogs as failure-safe seeds, augments Claude
only after a bounded version/provider probe, and asks the exact resolved
Copilot CLI for its authenticated inventory through its public headless
JSON-RPC surface. OpenCode retains its existing scoped CLI inventory.

## Model contract

Static `RUNTIME_MODEL_CATALOG` remains an offline seed and does not contain
Opus 5. A server-only resolver returns the effective options:

```text
static seed
  + Claude capability augmentation
  | Copilot authenticated replacement
  | OpenCode authenticated replacement
```

Successful inventories are cached briefly per runtime and familiar scope.
Failures are not cached as successes and fall back without adding Opus 5.
Concurrent requests share one in-flight probe.

Claude's capability rule is fail-closed:

- version 2.1.219 or newer is required;
- direct Anthropic, Bedrock, Claude Platform on AWS, and Vertex may use the
  release's `opus` mapping;
- Foundry and custom gateways require an explicit Opus 5 family mapping because
  their deployment names are user-defined;
- an explicit older `ANTHROPIC_DEFAULT_OPUS_MODEL` suppresses the option.

Copilot normalization always retains `github/auto`, accepts only safe bare CLI
ids, removes duplicates, and excludes `disabled` or `unconfigured` policy
entries. `claude-opus-5` becomes `github/claude-opus-5`.

## Routing and confirmation

The selected Cave id stays canonical in persisted intent and retry metadata.
Only the Claude launch argv is translated:

```text
anthropic/claude-opus-5 -> anthropic/opus -> coven -> claude --model opus
```

Copilot continues stripping `github/` at its existing direct-spawn boundary.
OpenCode receives its discovered provider-qualified id unchanged. A Claude or
Copilot stream model echo is the authoritative confirmed model; an absent echo
does not fabricate successful application.

## API and client parity

A runtime-model API serves the shared resolver to browser clients. The existing
OpenCode path remains compatible. `GET /api/chat/model-state` calls the same
resolver so iOS does not mirror catalogs. OpenCode's credential-scoped
inventory remains local-only; Claude and Copilot return only non-secret model
metadata.

The React hook keys inventory by both canonical runtime and familiar id. It
never shows one familiar's scoped inventory while another request is loading,
and it falls back to the static seed on request failure.

## Safety and bounds

- Model discovery never sends a prompt or consumes model usage.
- Claude version output and Copilot JSON-RPC bodies have byte limits and hard
  deadlines.
- Probe children receive the same resolved launch command and scoped
  environment as their runtime, with Claude's metadata child receiving only
  an allowlisted credential-free environment.
- Timeouts terminate the child and escalate to a forced kill after a short
  grace period.
- RPC parse failures return the seed catalog; stderr and payloads never enter
  user-visible diagnostics.

## Verification

Tests cover version boundaries, provider mappings, explicit older overrides,
custom gateways, policy-disabled Copilot models, malformed and fragmented RPC
frames, output limits, timeouts, deduplication, cache scope, web/iOS parity,
Claude native argv translation, Copilot and OpenCode forwarding, model labels,
and the 1M context window. Repository type, lint, wiring, app, API, and build
gates complete the audit.
