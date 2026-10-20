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

- [`workflows/github-work-tracking.md`](workflows/github-work-tracking.md): GitHub Issues and the Cave Project, ownership, Git-only hooks, worktrees, and handoff
- [`multi-session-coordination.md`](multi-session-coordination.md) — how concurrent agent sessions produce overlapping or orphaned work, and the hooks that catch it
- [`workflows/work-continuity.md`](workflows/work-continuity.md) — skill-driven discovery of existing work before planning or dispatch, with scoped evidence and honest handoff receipts
- [`source-text-pins.md`](source-text-pins.md) — contract-first source-reading tests, deliberate adoption counts, parser-over-regex guidance, safe extraction, and mutation testing
- [`performance-budgets.md`](performance-budgets.md) — the single catalogue of approved production performance budgets: which gate enforces each, why a missing measurement fails closed, and how a limit is seeded and re-seeded
- [`workflows/`](workflows) — branching, release, and PR mechanics

### Public APIs

- [`api/client-v1.md`](api/client-v1.md) — the Client v1 HTTP surface: the shared envelope, the loopback ingress rules, the pairing handshake, the administrator routes, the rate limits, and the routes that do not exist yet

### Platform and runtime

- [`client-v1-release.md`](client-v1-release.md) — the compatibility metadata a release advertises on `/api/client/v1/health`, and the fixture-check and release-smoke gates that protect it
- [`client-v1-settings.md`](client-v1-settings.md) — approving, denying, auditing, and revoking native client access in Cave Settings
- [`event-plane-operations.md`](event-plane-operations.md) — the invalidation WebSocket: switches, rollout modes, what each platform pauses, security, recovery and diagnostics
- [`device-access.md`](device-access.md) — opt-in tailnet allowlists, desktop-managed browser/iOS pairing, durable grants, revocation, and audit
- [`cross-environment.md`](cross-environment.md) — neutral defaults across Linux, macOS, and Windows, plus the per-OS deltas and the suite that enforces them
- [`runtime-startup-supervision.md`](runtime-startup-supervision.md) — why a reachable socket is transport availability, not runtime readiness
- [`model-catalog-pipeline.md`](model-catalog-pipeline.md) — the declarative source, generator, and validation workflow for harness model catalogs and context metadata
- [`first-run-setup-diagnostics.md`](first-run-setup-diagnostics.md) — server-classified failure codes for the first-run bootstrap
- [`settings-persistence.md`](settings-persistence.md) — why the desktop shell cannot use origin-keyed browser storage as its authoritative store
- [`windows-runtime-cache.md`](windows-runtime-cache.md) — the content-addressed archive layer and its two digests
- [`windows-update-preparation.md`](windows-update-preparation.md) — download, verify, and install as three distinct phases
- [`windows-upgrade-benchmark.md`](windows-upgrade-benchmark.md) — what `scripts/windows-upgrade-diagnostics.ps1` captures
- [`daemon-connectivity-reliability.md`](daemon-connectivity-reliability.md) — the daemon connectivity launch flow, readiness checks, fault coverage, and measurement contract; the `cave-58eoq` program's tracked work all merged (#4485–#4528), and its residual risks have no issue yet

### Mobile and handoff

- [`mobile-tailscale.md`](mobile-tailscale.md) — exposing the browser surface to a phone over Tailscale Serve, including tokenless tailnet-device access
- [`mobile-memory.md`](mobile-memory.md) — the read-only iOS client of the canonical-memory API
- [`ios-current-direction.md`](ios-current-direction.md) — the canonical native iOS product shape, active priorities, and historical-plan boundary
- [`workflows/ios-testflight-rollout.md`](workflows/ios-testflight-rollout.md): iOS rollout preparation, exact-artifact/device receipts, cohort HOLD decisions, and non-destructive recovery; execution acceptance remains open in #5319
- [`ios-webrtc-dsym-symbolication.md`](ios-webrtc-dsym-symbolication.md) — why TestFlight uploads warn that the vendored WebRTC.framework has no dSYM, and how the release pipeline audits and restores symbolication coverage

### Chat, familiars, and tasks

For saved transcript loading, start with these bounded entrypoints:

| Responsibility | Implementation and contracts | Focused verification |
|---|---|---|
| Cache/network history, offline/flow fallback, cancellation | [`src/lib/chat/history-load.ts`](../src/lib/chat/history-load.ts); `ChatHistorySources` and `ChatHistoryView` are its explicit ports | `node --experimental-strip-types --import ./scripts/test-alias-register.mjs --test src/lib/chat/history-load.test.ts` |
| Existing browser transport and encrypted caches | [`src/lib/chat/history-sources.ts`](../src/lib/chat/history-sources.ts), [`conversation-cache.ts`](../src/lib/conversation-cache.ts), [`offline-cache.ts`](../src/lib/offline-cache.ts) | Run `src/lib/chat/history-sources.test.ts`, `src/lib/conversation-cache.test.ts`, and `src/lib/offline-cache.test.ts` with the same Node test command |
| Live-generation admission, run ownership, effect cleanup and current-ref binding | [`src/components/chat-view.tsx`](../src/components/chat-view.tsx), [`chat-turn-state.ts`](../src/lib/chat-turn-state.ts) | `src/lib/chat-transcript-load.test.ts`, `src/components/chat-view-lifecycle.test.ts`, `src/components/chat-switching.test.ts` |
| Import boundary | `eslint.config.mjs` explicitly limits coordinator and transport imports; dynamic imports are rejected | `node --test scripts/eslint/chat-history-boundary.test.mjs`; `pnpm lint:source`, `pnpm typecheck`, `pnpm check:tests-wired` |

The coordinator receives current ownership through callbacks. A pending history
response cannot replace a send, edit, explicit reset or active generation.
Cancellation suppresses publication without aborting shared requests. A 404 is
authoritative absence; only a network failure can use offline history. The
transport reuses the existing authenticated cache and revision/write guards.


- [`familiar-identity-context.md`](familiar-identity-context.md) — how a familiar's declared identity reaches the model, and what the injection may not do
- [`local-models.md`](local-models.md) — Codex local mode on Ollama and LM Studio: setup, addresses, what stays on this computer, limitations and troubleshooting
- [`auto-mission-mode.md`](auto-mission-mode.md) — `/auto`, its status blocks, and the closing questionnaire
- [`orchestration-ready-tasks.md`](orchestration-ready-tasks.md) — the shared task contract every familiar and orchestrator reads and writes
- [`role-surfaces.md`](role-surfaces.md) — role-aware rooms, and why the Cave is not role-hardcoded
- [`chat-github-integration.md`](chat-github-integration.md) — the shipped GitHub integration and its turn-marker protocol
- [`chat-image-carousel.md`](chat-image-carousel.md) — image carousel markers, reusing the protocol above
- [`chat-proposal-review-card.md`](chat-proposal-review-card.md) — proposal-review receipt marker and evidence-only card (#5520)
- [`research-host-contract.md`](research-host-contract.md) — explicit core adapters and shared saved links for the optional Research package
- [`research-core-boundary.md`](research-core-boundary.md) — the optional Research boundary and the shared contracts core keeps; shipped in #6025 and enforced by `research-core-boundary.test.ts` and `research-maintenance-boundary.test.ts`
- [`research-run-surface.md`](research-run-surface.md) — durable ResearchMission projections across Chat, Quick Chat, and Research Desk
- [`execution-analytics.md`](execution-analytics.md) — model- and harness-level analytics: the three model identities, why harness version is never recorded, coverage as the honesty layer, and what the aggregate discards

### Knowledge, authoring, and marketplace

- [`knowledge-vault.md`](knowledge-vault.md) — curated reference knowledge injected into every harness, and how it differs from memory
- [`knowledge-packs.md`](knowledge-packs.md) — marketplace-distributed starter kits for a linked knowledge base
- [`covenwiki-render.md`](covenwiki-render.md) — reading generated CovenWiki manifests at `/wikis`: the read-only store, slug rules, the three API reads, and what the reader refuses
- [`prompt-packs.md`](prompt-packs.md) — where prompt templates come from and how they merge
- [`authoring-assist.md`](authoring-assist.md) — templating and agentic assistance across stitches, skills, and crafts
- [`marketplace.md`](marketplace.md) — the checked-in publisher catalog, and why the in-app view is deliberately narrower
- [`opencoven-submissions.md`](opencoven-submissions.md) — runtime and harness submission, validation, and publication
- [`mcp-doctor.md`](mcp-doctor.md) — debugging the two places MCP servers are listed

### Compatibility registries

- [`grok-compatibility-registry.md`](grok-compatibility-registry.md) — signed schema bundles and trust anchors for Grok Build
- [`openclaw-compatibility-registry.md`](openclaw-compatibility-registry.md) — the signed release guard, checkpoint, rotation, and rollback contract for OpenClaw event profiles
- [`opencode-compatibility-registry.md`](opencode-compatibility-registry.md) — the same contract for OpenCode event schemas

### Design

- [`coven-design-language.md`](coven-design-language.md) — the consolidated reference for how the product looks, moves, and speaks, written from shipped code
- [`beautiful-ui.md`](beautiful-ui.md) — the vendored Beautiful UI primitives: what the token adapter maps, why their CSS is scoped out of the root bundle, and why they are reference implementations rather than drop-in components

### Integrity and integrations

- [`dependency-advisories.md`](dependency-advisories.md) — open Dependabot alerts whose patched version is unreachable from this dependency graph: the resolver refusal, the exposure assessment, and the upstream change that would lift each
- [`stuck-action-runs.md`](stuck-action-runs.md) — the four Actions runs wedged in `queued` since 2026-07-25 (issue #4905): the HTTP-500 history, the 2026-08-30 HTTP-403 retry record, the do-not-delete-workflow-history rule, and the retry tooling
- [`project-permission-integrity.md`](project-permission-integrity.md) — reconciling stale grants against the project registry
- [`discord-rich-presence.md`](discord-rich-presence.md) — privacy-safe local activity publishing

---

## Program

Active initiatives. Parts have shipped; parts have not. Each states which.

- [`core-contract-and-room-boundaries.md`](core-contract-and-room-boundaries.md) — the minimal product contract and source inventory for #6119: all workspace modes, role rooms, auxiliary subsystems and startup workers, with current boundaries separated from unverified extraction and recovery acceptance
- [`desktop-onboarding.md`](desktop-onboarding.md) — the evidence baseline and product contract for download → first successful familiar response, separating confirmed behavior from proposals still needing usability and packaged-app testing
- [`ci-implementation-plan.md`](ci-implementation-plan.md) — the release-candidate CI rollout: signed promotion, full validation, the parallel `PR checks` context, and promotion at real release cuts have shipped; the protection switch, retiring routine PR fanout, and verifying the lean gate remain, with no tracking issue yet (#6111)
- [`roadmaps/coven-automations-v1.md`](roadmaps/coven-automations-v1.md) — the cross-repository Coven Automations v1 program (`OpenCoven/coven#854`) and its [machine-readable mapping](roadmaps/coven-automations-v1.mapping.json): foundation, protocol, scheduler reliability, embodiment, and authority have closed; dispatch-time trust (`coven#857`), certification (`coven#858`), the SDK, Cave oversight (#5217), Psyche, Docs, and organization canaries remain, and the 2026-10-18 release checkpoint is no-go
- [`performance/ios-performance-audit.md`](performance/ios-performance-audit.md) — the native iOS performance record (opened 2026-08-10, updated through 2026-10-03): instrumentation, the Release capture driver, and the budgets ratified on 2026-10-02 (#5292), none CI-enforced; the main-thread hitch budget (#5748), inline-zoom device evidence (#5314), and the physical-device gates remain

---

## Historical

Point-in-time records. Read for intent, not for current behavior.

- [`branch-cleanup-relaxation.md`](branch-cleanup-relaxation.md) - legacy Beads cleanup proposal (`cave-jcdgb`); its package commands are retired, and current authority and preservation requirements live in [GitHub work tracking](workflows/github-work-tracking.md)
- [`content-gen-flow-spec.md`](content-gen-flow-spec.md) and [`content-gen-flow-plan.md`](content-gen-flow-plan.md) — ⚠️ tombstoned 2026-08-28 (cave-a6zmc): both target `FLOW_TEMPLATES` in `src/lib/flow/flow-templates.ts`, which no longer exists; the symbol appears nowhere in the tree (removed in #3902). Content generation continues in the Research Desk surfaces.
- [`ios-native-rebuild.md`](ios-native-rebuild.md) — the multi-phase rebuild plan; its tokenless tailnet-trust model was replaced by pair-once mobile access tokens (#3310)
- [`ios-connection-cloud-plan.md`](ios-connection-cloud-plan.md) — draft planning anchor for onboarding, constant connection, and cloud persistence
- [`nav-history-tracking.md`](nav-history-tracking.md) — the read-only inventory (PR #4407)
- [`nav-history-full-tracking.md`](nav-history-full-tracking.md) — the successor prompt covering every navigable level
- [`projects-view-native-redesign.md`](projects-view-native-redesign.md) — proposal, awaiting approval
- [`research-desk-app-redesign-plan.md`](research-desk-app-redesign-plan.md) — implementation plan from a Claude Design handoff
- [`mobile-readiness.md`](mobile-readiness.md) — manual dogfood checklist for the `feat/mobile-readiness` rollout
- [`windows-sidecar-compression.md`](windows-sidecar-compression.md) — a zstd-level benchmark against a fixed production payload
- [`salem-chat-api-model.md`](salem-chat-api-model.md) — an outbound brief for the `opencoven-chat-api` repo, not a Cave contract
- [`golden-paths.md`](golden-paths.md) — the eight journeys mapped on 2026-07-09; every path's enablement plan has shipped (#2767–#5132), and several surfaces it describes have since moved
- [`craft-ux.md`](craft-ux.md) — the craft authoring audit and redesign; all six checkpoints shipped on 2026-07-15 (#3188–#3208), and `marketplace.md` (Living, above) describes the flow now
- [`research-extraction-verification.md`](research-extraction-verification.md) — candidate compatibility evidence and size and timing measurements for the Research extraction, which merged as #6025 (#5997 closed)
- [`plans/2026-07-26-dynamic-claude-opus-5.md`](plans/2026-07-26-dynamic-claude-opus-5.md) — capability-gated Claude Opus 5 across Claude Code, Copilot CLI, and OpenCode; shipped in #3954, and #5541 later limited the `opus` alias to Claude Code below 2.1.280
- [`plans/2026-07-29-ios-new-chat-project-contract.md`](plans/2026-07-29-ios-new-chat-project-contract.md) — binding native iOS first turns to a familiar-authorized project; shipped in #4067 and reworked by the chat-only shell (#5379); the current contract is [`specs/ios-new-chat-project-contract.md`](specs/ios-new-chat-project-contract.md)
- [`contracts/mobile-recovery-contract.md`](contracts/mobile-recovery-contract.md) — the transport-recovery contract proposed after the 2026-08-26 Serve-drift incident (#5051); #5056 and #5270 implemented its core rules differently, and `mobile-tailscale.md` (Living, above) describes current behavior
- [`coven-autoloop-cli-wrapper-spec.md`](coven-autoloop-cli-wrapper-spec.md) — scoping handoff for the unbuilt `bin/coven-autoloop` write path; the read path in `src/lib/research-autoloop.ts` already ships and is not what this describes
- [`2026-08-28 Coven Grimoire frame conformance`](audits/2026-08-28-coven-grimoire-frame-conformance.md) (`cave-wc0j7`) — frame-vs-surface conformance audit for `Coven Grimoire.dc.html`: the frame is a familiar-authored *publication* (issue contents, bylines, Share) while the repo's grimoire is the *memory* knowledge store; the collision is documented and the frame stays unbuilt pending a product decision

---

## Tombstone

- [`codeql.md`](codeql.md) — CodeQL retired 2026-07-31, in three ordered steps; nothing scans in its place

---

## Other trees under `docs/`

- [`api/`](api) — reference documentation for versioned public HTTP surfaces, listed individually under **Living** above
- [`superpowers/`](superpowers) — the approved spec and plan store that issues and PRs cite
- [`specs/`](specs) — **frozen** (55 files at the freeze, plus three added after it; `docs-index.test.mjs` pins the count). The earlier flat convention, which overlapped `superpowers/` from 2026-06-30 to 2026-08-06. Closed to new files, and deliberately not migrated: issues, PRs, and older plans cite these by path. See [`specs/README.md`](specs/README.md) for the reasoning and for the three undated standing contracts it holds
- [`plans/`](plans), [`audits/`](audits), [`contracts/`](contracts) — small point-in-time sets predating the `superpowers/` store; their documents are listed under **Historical** above
- [`roadmaps/`](roadmaps), [`performance/`](performance) — program records kept current; listed under **Program** above
- [`design/`](design) — runtime-activity design notes and their [`evidence/`](design/evidence) for the chat-observability work (#5761, #5767)
- [`client-v1-conformance-results/`](client-v1-conformance-results), [`release-acceptance-results/`](release-acceptance-results) — machine-written run records; see [client-v1 conformance](workflows/client-v1-conformance.md) and [release acceptance](workflows/release-acceptance.md)
- [`design-handoff/`](design-handoff), [`diagrams/`](diagrams), [`screenshots/`](screenshots), [`familiar-chatout-codex/`](familiar-chatout-codex) — supporting material

## Keeping this honest

When you add a document here, add its line to the right section. When a document
stops describing the product, move it to **Historical** rather than deleting it —
and when you remove a subsystem, leave a tombstone like `codeql.md` instead of
leaving a gap where the explanation used to be.
