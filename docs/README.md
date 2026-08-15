# Documentation index

Every document in `docs/` is one of four things, and the difference matters more
than the subject does. A reader who mistakes a proposal for a description of the
product will implement something that already exists — or worse, trust a
contract nothing enforces.

| State | What it means | How to treat it |
|---|---|---|
| **Living** | Describes how the product behaves now | Trust it; fix it when it drifts |
| **Program** | An active initiative, partly shipped | Trust the "shipped" parts, check the rest against code |
| **Historical** | A point-in-time record — a plan, proposal, draft, or measurement | Read as evidence of intent on its date, never as current behavior |
| **Tombstone** | Something deliberately removed | The removal is the content |

Dated design work does not live here. It goes in
[`superpowers/specs`](superpowers/specs) and [`superpowers/plans`](superpowers/plans) —
see [that store's README](superpowers/README.md) for the point-in-time contract.
A document in `docs/` proper should be one somebody keeps current.

---

## Living

### Working in this repo

- [`multi-session-coordination.md`](multi-session-coordination.md) — how concurrent agent sessions produce overlapping or orphaned work, and the hooks that catch it
- [`source-text-pins.md`](source-text-pins.md) — contract-first source-reading tests, deliberate adoption counts, parser-over-regex guidance, safe extraction, and mutation testing
- [`workflows/`](workflows) — branching, release, and PR mechanics

### Platform and runtime

- [`cross-environment.md`](cross-environment.md) — neutral defaults across Linux, macOS, and Windows, plus the per-OS deltas and the suite that enforces them
- [`runtime-startup-supervision.md`](runtime-startup-supervision.md) — why a reachable socket is transport availability, not runtime readiness
- [`first-run-setup-diagnostics.md`](first-run-setup-diagnostics.md) — server-classified failure codes for the first-run bootstrap
- [`settings-persistence.md`](settings-persistence.md) — why the desktop shell cannot use origin-keyed browser storage as its authoritative store
- [`windows-runtime-cache.md`](windows-runtime-cache.md) — the content-addressed archive layer and its two digests
- [`windows-update-preparation.md`](windows-update-preparation.md) — download, verify, and install as three distinct phases
- [`windows-upgrade-benchmark.md`](windows-upgrade-benchmark.md) — what `scripts/windows-upgrade-diagnostics.ps1` captures

### Mobile and handoff

- [`mobile-tailscale.md`](mobile-tailscale.md) — exposing the browser surface to a phone over Tailscale Serve, including tokenless tailnet-device access
- [`mobile-memory.md`](mobile-memory.md) — the read-only iOS client of the canonical-memory API

### Chat, familiars, and tasks

- [`familiar-identity-context.md`](familiar-identity-context.md) — how a familiar's declared identity reaches the model, and what the injection may not do
- [`auto-mission-mode.md`](auto-mission-mode.md) — `/auto`, its status blocks, and the closing questionnaire
- [`orchestration-ready-tasks.md`](orchestration-ready-tasks.md) — the shared task contract every familiar and orchestrator reads and writes
- [`role-surfaces.md`](role-surfaces.md) — role-aware rooms, and why the Cave is not role-hardcoded
- [`chat-github-integration.md`](chat-github-integration.md) — the shipped GitHub integration and its turn-marker protocol
- [`chat-image-carousel.md`](chat-image-carousel.md) — image carousel markers, reusing the protocol above

### Knowledge, authoring, and marketplace

- [`knowledge-vault.md`](knowledge-vault.md) — curated reference knowledge injected into every harness, and how it differs from memory
- [`knowledge-packs.md`](knowledge-packs.md) — marketplace-distributed starter kits for a linked knowledge base
- [`prompt-packs.md`](prompt-packs.md) — where prompt templates come from and how they merge
- [`authoring-assist.md`](authoring-assist.md) — templating and agentic assistance across stitches, skills, and crafts
- [`marketplace.md`](marketplace.md) — the checked-in publisher catalog, and why the in-app view is deliberately narrower
- [`opencoven-submissions.md`](opencoven-submissions.md) — runtime and harness submission, validation, and publication
- [`mcp-doctor.md`](mcp-doctor.md) — debugging the two places MCP servers are listed

### Compatibility registries

- [`grok-compatibility-registry.md`](grok-compatibility-registry.md) — signed schema bundles and trust anchors for Grok Build
- [`opencode-compatibility-registry.md`](opencode-compatibility-registry.md) — the same contract for OpenCode event schemas

### Design

- [`coven-design-language.md`](coven-design-language.md) — the consolidated reference for how the product looks, moves, and speaks, written from shipped code

### Integrity and integrations

- [`project-permission-integrity.md`](project-permission-integrity.md) — reconciling stale grants against the project registry
- [`discord-rich-presence.md`](discord-rich-presence.md) — privacy-safe local activity publishing

---

## Program

Active initiatives. Parts have shipped; parts have not. Each states which.

- [`daemon-connectivity-reliability.md`](daemon-connectivity-reliability.md) — the reliability program (`cave-58eoq`); Windows supervision and authenticated native readiness have shipped
- [`golden-paths.md`](golden-paths.md) — the eight journeys the Cave must make effortless, with per-item shipped/broken status
- [`craft-ux.md`](craft-ux.md) — a friction inventory of the craft authoring flow with a reuse-first enablement plan
- [`desktop-onboarding.md`](desktop-onboarding.md) — the evidence baseline and product contract for download → first successful familiar response, separating confirmed behavior from proposals still needing usability and packaged-app testing

---

## Historical

Point-in-time records. Read for intent, not for current behavior.

- [`content-gen-flow-spec.md`](content-gen-flow-spec.md) and [`content-gen-flow-plan.md`](content-gen-flow-plan.md) — ⚠️ both target `FLOW_TEMPLATES` in `src/lib/flow/flow-templates.ts`, which no longer exists; the symbol appears nowhere in the tree (removed in #3902)
- [`ios-native-rebuild.md`](ios-native-rebuild.md) — the multi-phase rebuild plan; its tokenless tailnet-trust model was replaced by pair-once mobile access tokens (#3310)
- [`ios-connection-cloud-plan.md`](ios-connection-cloud-plan.md) — draft planning anchor for onboarding, constant connection, and cloud persistence
- [`nav-history-tracking.md`](nav-history-tracking.md) — the read-only inventory (PR #4407)
- [`nav-history-full-tracking.md`](nav-history-full-tracking.md) — the successor prompt covering every navigable level
- [`projects-view-native-redesign.md`](projects-view-native-redesign.md) — proposal, awaiting approval
- [`research-desk-app-redesign-plan.md`](research-desk-app-redesign-plan.md) — implementation plan from a Claude Design handoff
- [`mobile-readiness.md`](mobile-readiness.md) — manual dogfood checklist for the `feat/mobile-readiness` rollout
- [`windows-sidecar-compression.md`](windows-sidecar-compression.md) — a zstd-level benchmark against a fixed production payload
- [`salem-chat-api-model.md`](salem-chat-api-model.md) — an outbound brief for the `opencoven-chat-api` repo, not a Cave contract

---

## Tombstone

- [`codeql.md`](codeql.md) — CodeQL retired 2026-07-31, in three ordered steps; nothing scans in its place

---

## Other trees under `docs/`

- [`superpowers/`](superpowers) — the approved spec and plan store beads cite (142 files)
- [`specs/`](specs) — **frozen** (55 files). The earlier flat convention, which overlapped `superpowers/` from 2026-06-30 to 2026-08-06. Closed to new files, and deliberately not migrated: beads cite these by path, including one open unit. See [`specs/README.md`](specs/README.md) for the reasoning and for the three undated standing contracts it holds
- [`plans/`](plans), [`audits/`](audits) — small point-in-time sets predating the `superpowers/` store
- [`design-handoff/`](design-handoff), [`diagrams/`](diagrams), [`screenshots/`](screenshots), [`familiar-chatout-codex/`](familiar-chatout-codex) — supporting material

## Keeping this honest

When you add a document here, add its line to the right section. When a document
stops describing the product, move it to **Historical** rather than deleting it —
and when you remove a subsystem, leave a tombstone like `codeql.md` instead of
leaving a gap where the explanation used to be.
