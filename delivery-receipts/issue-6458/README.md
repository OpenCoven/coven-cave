# Guided first-use qualification — issue #6458

The implementation candidate is `4907843411867fad32c6da44f622048839728b76` (tree `8a341235f16a32396eb59c79f14cef9c67d5d453`), based on `ee45870b621812602eb8d11bca3677d7f7a3f257`. Later commits carry verification receipts and source-contract maintenance only; the exact delivery head is recorded on the issue and draft PR. This is a local candidate and draft delivery, not merge, release or installed native acceptance.

The outcome is tracked by [issue #6458](https://github.com/OpenCoven/coven-cave/issues/6458), with [design decisions](../../docs/superpowers/specs/2026-11-11-guided-first-use-design.md) and [implementation plan](../../docs/superpowers/plans/2026-11-11-guided-first-use.md). Checkbox state is not evidence of completion.

## Verified behavior

| Area | Evidence | Boundary |
| --- | --- | --- |
| Method before execution | Production browser practice requires outcome, actual project/scope/actor, access choice, held approval, approval, Stop, retry and evidence; dismissal/reload resumes progress. | The sample calls no model and changes no project files. Installation state does not complete it. |
| Durable progress and defaults | Real store tests include missing/corrupt records, stale updates and six competing host processes; real route tests use a synthetic Unix daemon, project registry and permission stores. | Saved identities are preferences; current roster, path, effective grants and launch/runtime authority remain authoritative. |
| Context restoration and repair | Main, Tray and Notch restore concrete defaults; unavailable projects, removed members, revoked scope, missing runtimes, stale forms and failed/superseded reads retain identity and expose repair actions. | No first-roster or last-used actor substitution. All chats remains a browse overview. |
| Existing and pending work | Browser checks preserve an existing different actor/project/mode/draft, Home attachments, unfinished launches, invalid main/right-panel briefs, explicit retargeting and compact introduction handoff drafts. | Explicit context and bound conversations retain their authority. A failed read cannot slip through an automatic retry. |
| Delayed admission | Provider regression rejects superseded readiness; compact hook and browser checks preserve newer typing and typed skill briefs during delayed or refused validation. | Staged files are removed only after admission; stale thread generations cannot launch a replacement thread. |
| Other execution entry points | Voice checks precede microphone/mint requests; Enhance prompt, desktop Enhance tasks and shared browser generation guard respect introduction completion. | Server/CLI and autonomous workers retain their existing authorization contracts. |
| Access integrity | Universal local Read-grant Build admission and expected-access grant preconditions are reused from #6450, including behavioral route tests. | Selection and starter-folder creation grant no access. Verification changed synthetic grants only. |

## Local checks

| Check | Result |
| --- | --- |
| App suite | 1,510 test files passed in one complete final run. |
| API suite | 617 test files passed. |
| Mobile contract suite | 106 test files passed. |
| Production browser suite | 81 cases passed: desktop Chromium, Pixel 5 Chromium and iPhone 13 WebKit, with no retries. |
| Provider and compact-hook behavior | 28 tests passed, including superseded-read and newer-draft regressions. |
| TypeScript, lint, token/UI contracts and test wiring | Passed; all 2,242 test files wired. Existing token scan baseline remains 30 allowlisted undefined references; no new undefined token was introduced. |
| Production build and budgets | Passed; standalone output 7,794 files / 194,906,742 bytes, within the 12,000-file / 503,316,480-byte limits. |
| Source review | Prior Important findings repaired; focused review of `c07b4b9..4907843` found no new Critical or Important defects. Source review is separate from execution evidence. |

Test-runner children used separate short synthetic homes with `COVEN_HOME` and `COVEN_CAVE_HOME` overrides removed, so test-specific isolation remains effective. Earlier controls retained failures caused by inherited home overrides and an overlong Unix socket path. Repository state, real grants and existing installed-app sessions were preserved.

The production browser fixture answers unlisted APIs with an isolated failure, avoiding account-backed background reads. Qualification used the built application and canonical Playwright configuration with an ignored local launcher that starts the already-built server. Reproduction through the canonical configuration is `CI=1 pnpm exec playwright test tests/first-use-journey.spec.ts --project=desktop --project=pixel-5 --project=iphone-13 --no-deps --retries=0`; it rebuilds first. Suite commands are `pnpm test:app`, `pnpm test:api`, `pnpm test:mobile`, `pnpm typecheck`, `pnpm lint`, `pnpm check:ui-consistency`, `pnpm check:tests-wired` and `pnpm build`, with child-home isolation as above.

## Rendered and acceptance evidence

Keyboard traversal, Escape and focus return, 360×640 layout, dark/light and alternate Tide palettes passed in the production browser tests. The long guide uses the existing opaque raised-surface token after inspection found background copy showing through the shared glass Modal in narrow WebKit. The shared Modal keeps its existing default focus behavior; the guide opts into explicit keyboard cycling.

Inspected exports: [Coven dark](guide-narrow-coven-dark.png), [Coven light](guide-narrow-coven-light.png), [Tide dark](guide-narrow-tide-dark.png). These are synthetic browser screenshots, not physical-device evidence.

The default browser, Dia, displayed the production guide against a separate real synthetic filesystem/Unix-daemon fixture. Keyboard focus and the outcome-to-context transition were observed. Browser-host integration was unavailable, so inspection used the native accessibility surface; interaction stopped when the user switched windows. This is limited default-browser inspection, not a completed human walkthrough. That owned server was stopped and its loopback port verified closed.

Native installed-candidate acceptance, Tauri window/event handoff behavior, physical iPhone acceptance and human/screen-reader acceptance remain unqualified. Tray/Notch browser-route tests do not substitute for those checks. No merge, release, real-account grant change or unrelated worktree cleanup was performed.

## Retention and coordination

The issue-owned unit `.worktrees/issue-6458-guided-first-use` on `feat/issue-6458-guided-first-use` is intentionally preserved for draft review, with Val’s authorized implementation session as owner. The one-unit exception was used after a 39-unit audit; unrelated checkouts, dirtiness and ownership were preserved. No deletion authority is inferred from idle status.

Coordination with #6445/#6450 and #6215/#6443 was recorded on their issues, without claiming owner-session delivery or acknowledgement. Reused dependencies come from #6450 head `119a775f2a228c2ddfead75c327b2d90460f42dd`; the remaining access-repair UI stays with that owner. #6443 root pinning was not ported; the guide uses the existing public registration API and does not confirm legacy roots. Discovery coverage was bounded; private execution and Project-draft coverage remains unknown.

Raw first failures, passing runs, local production configuration, fixtures and process receipts are retained locally under ignored `artifacts/issue-6458/`. The committed log-hash manifest identifies the retained files without publishing account or tool output. Hosted CI state is reported separately on the draft PR and issue; local checks do not imply hosted checks passed.

Next action: review the draft PR before any native qualification, merge or release decision.
