# CLI verification guidance implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Checkboxes are not evidence of completion; code, verification receipts and merged PRs are authoritative.

**Goal:** Explain unverified CLI installations accurately and offer the existing Repair action without relaxing readiness.

**Architecture:** Extend the existing tool state model with explicit unverified provenance and pass that fact from both composers. Move the existing pure CLI readiness classifier into the existing onboarding probes module, consuming shared presentation; reuse the existing setup and Settings installer actions.

**Tech Stack:** TypeScript, React, Next.js route handlers, Node behavioral tests.

**Spec:** https://github.com/OpenCoven/coven-cave/issues/6156; parent #6119 and production evidence6305805114.

## Global constraints

- Coven CLI minimum remains `0.4.0`; package must remain `@opencoven/cli` with a verified executable.
- No new dependencies, installer changes, automatic replacement, data mutation, retry loop or daemon lifecycle changes.
- Unknown discovery stays unavailable and cannot produce an actionable install target.
- Missing optional provenance on legacy presentation inputs preserves their existing behavior; server composers always supply explicit facts.
- Keep shared controls, focus, announcement and disabled/busy behavior; only state/action/copy changes.
- Work only in the owned worktree. Preserve foreign #5981/#6155 work and user application homes.

## Review focus

- A high version reported by an unverified executable remains unready, with Repair rather than a false floor warning.
- Missing or wrong package identity, missing package path, missing executable path and failed executable verification all stay unverified.
- A verified unreadable version offers Repair; a verified version below `0.4.0` offers Update.
- Confirmed absence offers Install; incomplete discovery offers no invented action.
- A verified supported CLI stays ready without npm metadata; successful recheck clears repair guidance.

### Task 1: Preserve verification meaning through setup and Settings

**Files:**
- Modify: `src/lib/opencoven-tools-state.ts`, `src/lib/opencoven-tools-status.ts`, `src/lib/opencoven-tools-install.ts`.
- Modify: `src/lib/onboarding-status-probes.ts`, `src/app/api/onboarding/status/route.ts`, `src/components/onboarding-overlay.tsx`.
- Test: existing `opencoven-tools-state.test.ts`, `opencoven-tools-status.test.ts`, `opencoven-tools-install.test.ts`, `onboarding-status-probes.test.ts` and onboarding route contract.

**Interfaces:**
- `OpenCovenToolStateInput.packageVerified?: boolean`; explicit false yields new `unverified` state after missing and before version checks.
- `openCovenToolPresentation` maps unverified to Repair and installation-verification copy.
- `OpenCovenToolInstallStatus.state?: OpenCovenToolState`; primary label maps unverified/version-unreadable to Repair.
- `covenCliReadinessStep(tool: OpenCovenToolReadinessStatus | undefined, pathProbe: { state: "ready" | "absent" | "unavailable" }): OnboardingStatusStep` moves the existing classifier to the existing probes module. Unready detail comes from shared tool presentation; guidance names the matching action and retains reviewed installation prerequisites. Route uses it without changing probing/deadlines.
- Setup row uses `openCovenToolsPrimaryActionLabel([tool])`, preserving the existing onInstall handler. Settings already consumes shared presentation.

- [ ] Add behavioral fixtures covering all five review-focus classes, both composers, readiness false/true, selected action and unchanged allowlisted install command. State tests include explicit unverified facts that contradict compatible:true to prove they cannot present as ready.
- [ ] Run affected tests through exported canonical `nodeArgsFor` with isolated homes. Expected: failures for unverified classification, Repair selection and absent readiness helper. Retain RED evidence.
- [ ] Implement the minimal shared-state correction and move the existing pure readiness classifier; remove only obsolete source-pattern assertions superseded by behavioral tests. No installer or verification bypass.
- [ ] Re-run affected tests through canonical arguments. Expected: every file passes; provenance failures stay incompatible, unrelated states unchanged.
- [ ] Run related tool verification/resolution/update/display and onboarding tests, typecheck, scoped ESLint, test wiring, clock consistency, design/token and plan hygiene checks. Expected: successful exits and clean diff. Walk design checklist section9: no layout/style/motion/new control, existing focus/announcements intact; copy accurately names action. Browser/native qualification is not inferred from these unit tests.
- [ ] Commit scoped paths, push, run task-done with the canonical test selection, obtain one fresh independent exact-diff review, fix substantive findings with failing-first tests, and follow branch-to-merge for all selected exact-head hosted checks.

## Review correction

The independent review identified lost `lookup-failed` evidence in actual discovery. Preserve that probe marker, classify it as `unavailable` before absence, and suppress install targets and ready/not-found copy. This adds the marker to existing probe/client types and display handling, with no installer/admission change. The regression invokes real discovery with an isolated empty PATH, then a controlled finder confirming absence with exit1; both composers and action/readiness consumers are checked. The POSIX finder exercise is platform-specific; the shared unavailable-state test runs on every platform.
