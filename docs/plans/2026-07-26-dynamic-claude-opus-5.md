# Dynamic Claude Opus 5 implementation plan

**Goal:** Make Claude Opus 5 a capability-driven model across Claude Code,
Copilot CLI, and OpenCode, with one shared inventory contract and verified
native routing.

**Architecture:** Pure model capability and normalization helpers feed bounded
server probes. A shared server resolver combines those results with the static
fallback catalog, and both browser and model-state APIs consume that resolver.
The send route translates only the canonical Claude Opus 5 id to Claude Code's
portable `opus` selector.

---

### Task 1: Pin the pure model contract

**Files:**
- Create: `src/lib/claude-models.ts`
- Create: `src/lib/claude-models.test.ts`
- Create: `src/lib/copilot-models.ts`
- Create: `src/lib/copilot-models.test.ts`
- Modify: `src/lib/runtime-models.ts`
- Modify: `src/lib/runtime-models.test.ts`

1. Add failing tests for the Claude 2.1.219 boundary, provider modes, explicit
   mappings, Copilot policy filtering, stable ids, and static-fallback
   invariants.
2. Run the focused tests and confirm the new assertions fail for missing
   behavior.
3. Implement the smallest pure helpers and rerun until green.

### Task 2: Build bounded runtime discovery

**Files:**
- Create: `src/lib/server/claude-models.ts`
- Create: `src/lib/server/claude-models.test.ts`
- Create: `src/lib/server/copilot-models.ts`
- Create: `src/lib/server/copilot-models.test.ts`
- Create: `src/lib/server/runtime-model-options.ts`
- Create: `src/lib/server/runtime-model-options.test.ts`

1. Add failing tests for success, fragmented frames, malformed payloads,
   byte limits, deadlines, process errors, forced cleanup, cache scope, and
   failure fallback.
2. Implement the credential-safe Claude version probe and exact-launch Copilot
   `models.list` client.
3. Implement short-lived successful-result caching with in-flight request
   coalescing.
4. Run all new server tests.

### Task 3: Give every client the same inventory

**Files:**
- Create: `src/app/api/runtime-models/[runtime]/route.ts`
- Create: `src/app/api/runtime-models/[runtime]/route.test.ts`
- Modify: `src/app/api/runtime-models/opencode/route.ts`
- Modify: `src/app/api/runtime-models/opencode/route.test.ts`
- Modify: `src/app/api/chat/model-state/route.ts`
- Modify: `src/app/api/chat/model-state/route.test.ts`
- Modify: `src/lib/use-runtime-model-options.ts`
- Modify: `src/lib/use-runtime-model-options.test.ts`

1. Add failing API/source-contract tests for shared resolver use, familiar
   scope, OpenCode locality, and dynamic response behavior.
2. Wire the shared resolver into the runtime and model-state APIs.
3. Generalize the React hook without changing picker presentation.
4. Run the API and hook tests.

### Task 4: Route and report Opus 5 faithfully

**Files:**
- Modify: `src/app/api/chat/send/route.ts`
- Modify: `src/app/api/chat/send/harness-routing.test.ts`
- Modify: `src/lib/copilot-stream.test.ts`
- Modify: `src/lib/opencode-models.test.ts`
- Modify: `src/lib/model-label.test.ts`
- Modify: `src/lib/context-meter.ts`
- Modify: `src/lib/context-meter.test.ts`

1. Add failing tests for canonical-to-native Claude translation, Copilot's bare
   id, OpenCode pass-through, readable labels, and the 1M context window.
2. Implement the launch translation while preserving canonical persisted and
   retry state.
3. Rerun the focused routing and metadata suites.

### Task 5: Complete the repository audit

1. Run all focused tests added or changed above.
2. Run `pnpm check:tests-wired`.
3. Run `pnpm lint`.
4. Run `pnpm typecheck`.
5. Run `pnpm test:app`.
6. Run `pnpm test:api`.
7. Run `pnpm build`.
8. Inspect `git diff --check`, the complete diff, and the final worktree
   status.
9. Record exact verification evidence and any environment-limited gate in
   Bead `cave-im15r`; do not close it before merge or explicit completion.
