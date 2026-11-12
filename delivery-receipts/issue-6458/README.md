# Guided first-use qualification — issue #6458

[PR #6462](https://github.com/OpenCoven/coven-cave/pull/6462) implements [issue #6458](https://github.com/OpenCoven/coven-cave/issues/6458), with [design decisions](../../docs/superpowers/specs/2026-11-11-guided-first-use-design.md) and [implementation plan](../../docs/superpowers/plans/2026-11-11-guided-first-use.md). The approval repairs were qualified on top of `880247b44a9560443042e588543b7f3f4e17a202`; the exact published head, hosted checks and merge outcome belong to the PR and canonical issue. This receipt records local evidence and its limits.

## Verified behavior

| Area | Evidence | Boundary |
| --- | --- | --- |
| Method before execution | Production browser practice requires outcome, actual project/scope/actor, access choice, held approval, approval, Stop, retry and evidence; dismissal/reload resumes progress. | The sample calls no model and changes no project files. Installation state does not complete it. |
| Durable progress and defaults | Real store tests include missing/corrupt records, stale updates and six competing host processes; real route tests use a synthetic Unix daemon, project registry and permission stores. | Saved identities are preferences; current roster, path, effective grants and launch/runtime authority remain authoritative. |
| Context restoration and repair | Main, Tray and Notch restore concrete defaults; unavailable projects, removed members, revoked scope, missing runtimes, stale forms and failed/superseded reads retain identity and expose repair actions. Explicit All projects survives hydration and reload. | No first-roster or last-used actor substitution. All chats remains a browse overview. |
| Existing and pending work | Browser checks preserve an existing different actor/project/mode/draft, Home attachments, unfinished launches, invalid compact briefs, explicit retargeting and interrupted skill drafts. Home refreshes the complete default scope before admission. | Explicit context and bound conversations retain authority. Bound-chat guidance lives in the existing menu and preserves transcript space and focus return. |
| Delayed admission and Stop | Provider and compact-hook regressions reject superseded readiness, preserve newer typing/files, and prevent pending follow-up validation from admitting a replacement after an accepted Stop. | Failed/no-op Stop and natural completion preserve their existing behavior. Staged files are removed only after admission. |
| Access and runtime | Effective access uses the direct/group grant union; supreme designation cannot imply Write. Passive readiness follows the selected SSH, Hermes API, paired OpenClaw Gateway or local transport and authorized project root. | Passive availability makes no provider connection, grants no access and does not replace send-time validation. Universal Read-grant Build rejection and grant preconditions remain enforced. |
| Preferences and voice | Automatic writes cannot manufacture a saved Build choice before reviewed host Explore restores. Automatic voice waits for project readiness and retains the target-session guard. | Genuine local access choices remain authoritative. Navigating away prevents a later automatic voice opening. |

## Approval-turn local checks

| Check | Result |
| --- | --- |
| Complete app suite | 1,514 test files passed. |
| Complete API suite | 620 test files passed. |
| Mobile contract suite | 106 test files passed. |
| Final production browser run | 121 cases passed without retries: 99 first-use cases across desktop Chromium, Pixel 5 Chromium and iPhone 13 WebKit, plus 22 existing phone transcript/composer layout cases. |
| Repeated original keyboard oracle | 30/30 passed without retries, ten runs on each browser platform. |
| Final guide and journey-route behavior | 29 tests passed, including the pre-initialization stale-alert regression and genuine concurrent revision mismatch. |
| Accepted-Stop behavior | All 32 compact-hook cases passed, including held default validation, accepted/rejected Stop and retained draft/files. |
| TypeScript, lint, UI contracts and wiring | Final build typecheck, full lint plus focused final-guide lint, UI consistency and all 2,249 test files wired passed. Existing token baselines were retained. |
| Final production build and budgets | Passed with `NEXT_PUBLIC_CAVE_ROOMS=all`; standalone output 7,797 files / 1,274 directories / 194,912,688 bytes, within the 12,000-file / 503,316,480-byte limits. Root CSS 557 KB / 640 KB; first-load CSS 643 KB / 945 KB. |
| Source review | Final read-only review found no Critical or Important findings. Tracked-diff SHA-256 `ba3fc04c904c3f7e390b299ec18832514d02669f41413e535c208a8cc8cac300`; snapshot including new behavior tests/helper `33f55967bfaa2b71ce6a62c8be32efa3ad8a7edcafc24057538f6b314de6d5d1`. |

The complete suites passed before the final one-line guide initialization guard; its subsequent meaningful verification was the 29 behavior tests, 30 repeated original keyboard cases, 121-case final production run, final typechecked build and focused lint. The first failure showed Tab focusing a transient “Reload saved context” button that initialization then removed. The regression observes the committed frame before passive effects; genuine later revision changes still show Reload and block Save. The shared focus hook was unchanged by this repair.

Affected legacy browser fixtures now declare the installation and workspace scope they intend to exercise. Qualification passed chat entry/activity/context/output, first-project repair, familiar queue, right chat, Grimoire, Code Desk, Research tabs, journal/memory scale/traversal, reader/publish recovery, quick chat, project Home and voice cases. Representative complete groups include 41 context cases with 38 existing project skips, 11 Grimoire cases, 19 normal Research-tab cases, 11 memory cases, 25 reader/publish cases and 23 additional chat/voice cases. Code Desk’s existing drawer-floor check passed three repeats and the selected 12-case suite without changing its threshold, timeout or assertion. Counts overlap and are not an aggregate. Eight flag-enabled Research cases were excluded from the local flag-off build and require the separate hosted agentic job.

Test-runner children used separate short synthetic homes with inherited `COVEN_HOME` and `COVEN_CAVE_HOME` overrides removed. Earlier first failures from home isolation, Unix socket length, old implicit-context fixtures and the focus race remain retained. No real-account grant or installed-app session was changed.

The browser fixture fails unlisted APIs instead of reading account-backed state. After the final production build, static/public assets were copied once; isolated loopback servers then read the same frozen build without rewriting each other’s assets. Reproduction uses the canonical Playwright configuration with `NEXT_PUBLIC_CAVE_ROOMS=all`; local ignored launchers only skip rebuilding/copying an already-qualified build. The canonical suites and assertions remain unchanged except for the explicit first-use fixtures and added regressions.

## Rendered and acceptance evidence

Keyboard traversal, Escape and focus return, narrow layouts, dark/light and Tide palettes passed in production browsers. Inspected exports include [Coven dark](guide-narrow-coven-dark.png), [Coven light](guide-narrow-coven-light.png), [Tide dark](guide-narrow-tide-dark.png) from the initial qualification and [guidance reopened from a bound iPhone-browser chat](approval-guidance-open-iphone-13.png) from the approval work. These are synthetic browser screenshots.

The initial default-browser inspection used Dia against a separate synthetic filesystem/Unix-daemon fixture. Opening screens, keyboard focus and the outcome-to-context transition were observed before the user switched windows. This remains limited browser inspection. Installed native acceptance, Tauri window/event handoff, physical iPhone and human/screen-reader acceptance remain unqualified; browser-route checks do not substitute for them. Release delivery is separate.

## History, retention and coordination

The initial runtime candidate was `4907843411867fad32c6da44f622048839728b76`, based on `ee45870b621812602eb8d11bca3677d7f7a3f257`, with initial draft delivery `44549daf534d5f00ad217fba726ce0e6b5fa877f`. Its 1,510 app / 617 API / 106 mobile / 81 browser results and [original log hashes](log-hashes.json) are historical evidence, superseded for delivery by the approval repairs and current exact-head checks.

The issue-owned unit `.worktrees/issue-6458-guided-first-use` on `feat/issue-6458-guided-first-use` is intentionally preserved, with Val’s authorized implementation session as owner, for recovery and verification after protected delivery. The one-unit exception followed the initial 39-unit audit. Unrelated worktrees and owners remain untouched; no deletion authority is inferred from idle status or merge.

Coordination with #6445/#6450 and #6215/#6443 was recorded on their issues without claiming owner-session delivery or acknowledgement. Read-grant Build admission and grant preconditions reuse #6450 head `119a775f2a228c2ddfead75c327b2d90460f42dd`; its other access-repair UI remains separately owned. #6443 root pinning was not ported. Private execution and Project-draft discovery coverage remains unknown.

Raw first failures, passing logs, local configurations and process receipts are retained under ignored `artifacts/issue-6458/`. The [approval log-hash manifest](approval-log-hashes.json) identifies the retained logs without publishing account or tool output. Hosted CI and the protected merge outcome are reported separately on the PR and issue; local passes do not imply hosted success.
