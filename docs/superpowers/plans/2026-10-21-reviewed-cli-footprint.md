# Reviewed CLI Footprint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan inline. Checkboxes are not evidence of completion; consult code, merged PRs and the execution ledger.

**Goal:** Fresh setup installs the released lightweight CLI without the separate memory dashboard's application dependencies.

**Architecture:** Change the existing reviewed install record from CLI 0.4.0 to 0.4.10 with its matching registry integrity. Reuse the existing installer, verification, lifecycle and optional-companion behavior; add no runtime mechanism.

**Tech Stack:** TypeScript prerequisite manifest, npm release artifacts, production Next.js server, real Coven daemon and Chromium.

**Spec:** [Issue #6164](https://github.com/OpenCoven/coven-cave/issues/6164), under [program #6119](https://github.com/OpenCoven/coven-cave/issues/6119).

## Global Constraints

- Keep the minimum compatible CLI version `0.4.0`; this changes the reviewed installation target only.
- Preserve fixed installer arguments, package provenance checks and private managed Node/npm paths.
- Use existing released `0.4.10` artifacts; do not publish releases or alter existing user installations.
- Keep tests and faults in isolated homes; retain data, process ownership checks and cleanup evidence.
- Report file bytes separately from startup latency, OS allocation, native/mobile acceptance and provider performance.

## Review Focus

- Wrong version/integrity pairing: compare all five released package records against the existing release-canary lockfile and registry.
- Hidden dashboard dependency: inspect the real fresh npm tree and compare its logical file footprint with the retained 0.4.0 installation.
- Installer selects a different executable: verify installed package provenance and the running daemon's PID, socket and start identity.
- Recovery leaves stale views or resources: exercise the actual setup UI, await reconciliation, stop the owned daemon and verify cleanup.
- Companion removal changes core behavior: verify daemon/familiars/memory access without the dashboard; retain the existing actionable companion-install response.

### Task 1: Adopt and verify the reviewed lightweight CLI

**Files:** Modify `src/lib/onboarding-prerequisites.ts` and its existing `onboarding-prerequisites.test.ts`; add this plan and `docs/reviewed-cli-install-verification.md`.

**Interfaces:** Consume the existing `prerequisiteById("coven-cli")` install record. Produce the same interface with version `0.4.10` and integrity `sha512-3sJy/55/3X9W7paERLmHb/76tIHV4OSXD2HInqOTDEBhLCIaO422VPJQhhmhJNgu7a/mIzJKEODgwcDCKW0UUA==`.

- [ ] Record the failing dependency-absence check against the actual fresh 0.4.0 installation; verify the new release metadata and existing canary pins.
- [ ] Update the existing manifest contract's version/integrity assertions and observe the expected failure before changing production.
- [ ] Update only the reviewed CLI version and integrity; preserve the compatibility floor.
- [ ] Run prerequisite, installer, tool-verification, bootstrap and API contracts through their canonical runner; run full typecheck and scoped lint.
- [ ] Commit and push the verified source; build production from the exact clean head.
- [ ] Exercise real fresh setup, absent companion/core memory behavior, intended daemon identity, UI reconciliation and cleanup; record the footprint and limitations.
- [ ] Obtain one fresh whole-branch review, resolve substantive findings in one pass, and deliver through exact-head protected checks and merge.

Checkboxes describe the execution plan. The issue and ignored execution ledger carry current evidence and completion state.
