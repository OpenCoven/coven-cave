# Research Room Styles Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan inline, followed by one independent whole-branch review.

Checkbox state is not evidence of completion. Verify current code, test results, and merged PRs; issue #6144 owns the work record.

**Goal:** Keep Research styles out of core startup and absent-package builds while preserving the enabled room's appearance.

**Architecture:** Move the Research-only suffix of the global role stylesheet into a room sheet. A capability-gated host entry imports that sheet before re-exporting the existing optional client; package detection selects the entry or the existing absent stub.

**Tech Stack:** Next.js, TypeScript, CSS, Playwright, Vitest.

**Spec:** https://github.com/OpenCoven/coven-cave/issues/6144; parent #6119.

## Global Constraints

- Keep generic room furniture in core and preserve retained declarations and rule order.
- No package release, dependency change, chunking override, lifecycle or authority change.
- Use isolated production fixtures; no real daemon or user-state mutation.
- Preserve existing design gates, capability-before-import and missing/disabled states.
- Source-byte movement is not a latency or installed-size claim.

## Review Focus

- Absent package builds must not reference the host room or its CSS.
- A disabled capability must not import the room even after an earlier warm activation.
- The moved sheet must precede package overrides in production, including container queries.
- Chunk failure must still reach the existing host error boundary; unmount must not revive a room.
- Styles may remain cached after activation; do not claim CSS unloading or worker teardown from this change.

### Task 1: Gate Research styles with the optional room

**Files:**
- Modify: `src/styles/globals/surface-role-workspaces.css`
- Create: `src/styles/research-room.css`
- Create: `src/components/role-surfaces/researcher-room.ts`
- Modify: `src/components/role-surfaces/researcher-surface-loader.tsx`
- Modify: `scripts/research-package-config.mjs`, `tsconfig.json`
- Test: `tests/research-desk-tabs.spec.ts`, `src/components/role-surfaces/researcher-surface-loader.test.tsx`

**Interfaces:**
- Consumes: existing `ResearchCapability.enabled`, `ResearcherSurface({ context: RoleSurfaceContext })`, and `researchPackageConfig(root).aliases`.
- Produces: `@opencoven/research-room` alias resolving to the styled host entry only when the package exists; absent fallback otherwise. Existing client alias remains unchanged.

- [x] Add a production browser regression that inspects actual loaded CSS before activation, under disabled/absent capability, and after enabled room activation. Attach computed styles for matched baseline comparison.
- [x] Run the regression against unchanged production source with one worker and no retries. Expected: pre-activation CSS assertions fail; actual enabled room still renders. Retain production CSS sizes and browser attachments.
- [x] Move the exact Research suffix, introduce the optional styled entry, and update the loader and its mock boundary. Keep global chunking and dependencies unchanged.
- [x] Run the same production regression plus existing four-width Research journeys. Expected: no Research styles before enabled activation; enabled room layout, focus and interactions pass. Compare baseline computed styles and root CSS bytes.
- [x] Verify a physically absent-package export builds and its output excludes the moved CSS. Expected: core build succeeds and Research rules are absent.
- [x] Run `pnpm typecheck`, `pnpm lint`, scoped loader/design/boundary tests and `pnpm check:tests-wired`. Expected: all pass without baseline relaxation.
- [ ] Record evidence and limitations, commit and push, request one independent exact-diff review, then land through protected checks under existing goal authority.
