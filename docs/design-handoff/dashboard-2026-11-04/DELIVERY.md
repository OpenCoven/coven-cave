# D0 local review and delivery packet

## Packaging follow-up — 16 November 2026

Status: follow-up to draft PR head `5137337489fc1bf306aa899d9bac1937b7b2f426`, whose hosted CI passed (26 successful checks; iOS path selection skipped). That CI applies to the earlier head, not this follow-up. The package remains local, separately identified and ad hoc signed; no installed user app was replaced and no release was published.

The first canonical native package exceeded the unchanged 9,045-file runtime budget: 9,060 files. A detached current-main baseline passed at 9,041 files. The difference was 19 generated Next chunks with identical dependency and non-Next closure membership. Importing the small Home overview directly from Workspace instead of introducing another lazy boundary restores the candidate to 9,041 files, 1,369 directories and 139,722,561 bytes without raising the budget. The reviewed tradeoff is 10 KB more first-load JavaScript and 3 KB more first-load CSS than the earlier candidate; no performance improvement is claimed. Scope, hooks, policy and component-local CSS remain unchanged.

Build `EFY6M3a7gR-UKv-NDFKO3` passes the canonical production build, strict sidecar/runtime budgets, 55 Home/Activity browser cases and 37 retained/mode cases with zero retries/skips, and all 1,528 app files with the same two unsupplied native-supervisor cases skipped. Touched-component ESLint passes. First-load JS is 1,752 KB, first-load CSS 672 KB and root CSS 556 KB; standalone output is 7,816 files / 195,197,234 bytes. A concurrent app run failed when packaging temporarily removed tracked resource placeholders; after restoring the owned placeholders, all 32 release-runtime cases and the full app rerun pass unchanged. The failed run remains retained.

All five controlled-provider production HTTP scenarios also pass on `EFY6M3a7gR-UKv-NDFKO3`, including ring eviction with actual finished-buffer expiry. Every scenario verifies no duplicate effect and complete server/daemon/scratch teardown; the sanitized follow-up reports retain their exact build and raw-report digests. These are real-daemon HTTP results with a synthetic provider, not native/rendered/real-provider acceptance. A preliminary command using a relative evidence path was rejected before startup; the required absolute paths were used for the runs.

The local release-profile test bundle passes strict deep signature verification, uses isolated identifier `ai.opencoven.cave.d0review6403`, and contains the same verified build. Its executable SHA-256 is `4428fef7a7e4045fd981e5c36932e51795824b92a9c90e40bfd46fd650953d26`. The earlier debug-profile bundle failed sidecar startup while loading development configuration; it is retained as a failed attempt. Neither compile success nor signing proves native acceptance.

In the release-profile app, native accessibility exposes the Home composer, overview and first-use controls, but repeated native captures show only chrome and a blank center. Dismissing first-use setup updates accessibility state while the center remains blank. One pointer action returned `noWindowsAvailable`; rebinding the same test app recovered its accessibility tree, without establishing rendering. The controlled-provider qualification was explicitly aborted with zero provider requests. App termination, sidecar closure, daemon termination and scratch-state removal all verify successfully. This attempt does not qualify native rendering, producer behavior, human VoiceOver or visual acceptance. The user's installed app session remains untouched.

Source tuple: `080c36e59bfc4d32c02ea093b026d5bc072e79bfb71f98dbbf97482fa2bc1bb1` (19 files), retained at `artifacts/issue-6403/continuation-20261116/consolidated-source-tuple.json`. Earlier build receipts and captures below remain historical and are not relabeled as captures of this package. The detached main-baseline worktree is intentionally preserved for this ongoing comparison; it owns no outcome or competing implementation.

## Continuation — 16 November 2026

Status: local update to the existing draft PR #6438, not merged or accepted. Codex for Val continues the original `632c6f5d` candidate in `.worktrees/issue-6403-d0-on-main-632c6f5d`; no familiar identity is asserted. Both locked source/review worktrees remain untouched. Original PR head `94c90e7f34873fb8e2ba4825028024bdfef9d491` is integrated with main `ea2f41fbcf618cc80a1b6ab6ce03b912a347ea26` without conflicts. T1/T2's delivered changes and the delivered Settings Back repair #6444 remain included; #6479's separate pairing/device acceptance remains with its owner.

Val delegated the outstanding product choices to the agent's recommendations in three replies. The resulting choices are composer first; keep Continue and disclose settled Overview history; leave attention, running work and unknown execution visible; retain the reload warning for document-owned staged files; use a static live Activity icon for everyone; and publish only source digests. These choices do not constitute human VoiceOver, visual, native or producer acceptance. Delivery remains a draft while the original acceptance gates are unmet.

The focus correction preserves a collapsed row when its focused summary moves into settled history, opening enclosing history/overflow disclosures only. A focused expanded conversation action still retains its expansion and focus. The existing canonical state reducers, provenance, receipts and unavailable/unknown boundaries remain in use. Current main's history projection, offline-cache sanitization, search projection, URL history and native thread-cache revocation files are byte-identical after integration.

| Gate | Current evidence |
| --- | --- |
| Final production artifact | Build `dDk6V-_wg8zd9MVjZri81`; TypeScript and build budgets pass. First-load JS 1,742 KB; root CSS 556 KB; first-load CSS 669 KB; standalone 7,833 files / 195,208,153 bytes. No matched-baseline performance improvement is claimed. |
| Home and Activity | Final canonical production-build command passes 55 cases with one worker, zero retries and zero skips, including the new collapsed-summary assertion. |
| Retained paths and effective mode | Same final build passes 37 cases: Continue on desktop/Pixel 5/iPhone 13, header geometry, retired Salem compatibility and selected first-use Read/Full regressions. Existing project-grant labels remain separate from the reviewed new-chat runtime mode. |
| App | Both the initial and final post-correction runs pass all 1,528 files; each retains two real-native-supervisor skips because the exact binary was not supplied. |
| API | 625 files pass, no skipped cases. Includes canonical disclosure/replay/history routes; this is not real-provider or packaged-client acceptance. |
| Static | Full lint, final touched-component ESLint, 2,269-file test wiring, UI consistency and staged/unstaged whitespace checks pass. |
| Production HTTP | Five first-attempt recovery scenarios pass on the final build: split secrets/Unicode fragmentation, parallel reordered calls, visible persistence failure, ring eviction plus finished-buffer expiry, and cancellation after an effect. Each uses a real scratch daemon, built server and fsynced child-process counter with a synthetic provider; replay/history/restart do not duplicate effects. Managed revocation and missing/invalid read credentials refuse access. All five verify server/daemon/state teardown. See [the sanitized receipt](verification-2026-11-16.json). These are HTTP results, not browser/native or real-provider acceptance. |
| Source | All three supplied Downloads files still match their recorded digests; no private archive or extracted source is added. The source-location/adoption gate stays cleared. |
| Review | Read-only review found the collapsed-summary issue, reproduced by a failing browser assertion and corrected before the final 55-case pass. No additional actionable regression was identified in the reviewed scope. |
| Captures | 29 final browser captures retained locally. Wide Coven dark/light, narrow Coven dark and narrow history/Continue captures inspected and copied to `.github/pr-screenshots/issue-6403/home-composer-first-*` and `home-history-390-dark.png`. Fixture captures are not human visual sign-off. |

Exact logs, source tuple, failed attempts, browser outputs and local production-probe receipts are retained in `artifacts/issue-6403/continuation-20261116/`. Source-tuple SHA-256: `cefa7645a092c88bc92097186c9bd1734f3ef9b5b0611b30231fe28d053aa8aa` (19 production/test/runner files). The ignored existing-build config preserves the canonical isolated state/access configuration and changes only test-directory/cwd resolution and the command to start the already-built artifact.

Preserved first failures: the new composer-first browser assertion failed with zero viewport intersection before presentation changed; the collapsed-summary assertion failed because its row opened before the focus correction. The intermediate 55-case and 32-case passes remain separate from the final build's 55 and 37. No assertion, retry setting or skip was weakened to obtain a pass.

The additional interactive scratch-daemon/browser qualification is incomplete; it is separate from the five passing HTTP scenarios above. The first reconnect harness reached setup without a browser credential and was explicitly aborted before a provider request. The supported browser fixture then reached the real setup and editable Chat draft using its scoped credential handoff. The UI controller timed out and rebound to another active browser window before effective-mode inspection or sending; no further action was taken in that window. Both attempts record zero provider requests, failure and verified fixture/server/daemon teardown; the supported browser fixture also records zero tool invocations. They are not producer acceptance. No real provider was called, and no installed app session was replaced or stopped.

Remaining original gates are enumerated in [ACCEPTANCE.md](ACCEPTANCE.md). Keep #6403 open and the worktree intentionally preserved for the existing outcome. Next: finish draft publication, then complete the remaining rendered-producer/privacy, packaged/native, human accessibility and visual rows through their responsible owners.

## Rebuilt on main — 9 November 2026

Status: draft PR for Val's review, not merged. Canonical outcome: [#6403](https://github.com/OpenCoven/coven-cave/issues/6403) under #6396. This section supersedes the status lines of the 7 November packet below, which describe the earlier uncommitted candidate and remain its record.

The D0-only change from the 7 November review candidate was replayed onto main `fea63da7a524d7a78e22b63e414ef9e6023ffe3c`. That main already carries T1 (#6410), T2 (#6408), the Submissions slices (#6412) and the startup identity fix (#6426), so none of them is repeated here. Where main had changed the same lines, main's version was kept. The candidate's Webpack dev fallback was a host workaround and is not included. The vendored handoff source is not published in this repository; the [manifest](manifest.json) digests identify it, and its bytes remain in the D0 owner and review worktrees.

| Evidence | Result |
| --- | --- |
| Static gates | Typecheck, full lint, conflict markers, test wiring (2,234 files) and UI consistency pass. |
| Unit suites | App: 1,505 files pass; the two native-supervisor cases skip because their provider binary was not supplied. API: 614 files pass, none skipped. |
| Browser, production build with `CI=true`, Chromium | 70 cases across `home-overview`, `d0-retired-navigation`, `chat-activity-acceptance` and `chat-header-title-room` pass on the first attempt, with no retries or flakes. |
| Review walk | Home, Chat, inline Activity, Settings and back to Home, driven by keyboard at 1440 and 390 px in light and dark, with and without reduced motion: 4 of 4 pass. Every focused control shows a 2 px solid outline, and no page errors occur. |
| Hosted CI, first PR head `7ef7868a5` | [Run 42733676961](https://github.com/OpenCoven/coven-cave/actions/runs/42733676961) failed `Frontend build`. E2E shards 4 and 6 failed 20 Continue carousel cases on desktop, Pixel 5 and iPhone 13, and each failed its retry too. The candidate hid the Continue carousel whenever the overview showed. That retired a shipped surface (#4933) without a recorded decision, and the local D0-only browser run did not include its specs. The carousel now stays below the composer, as on main; whether to retire it is Val's call. |
| Browser, after restoring Continue | Carousel specs on desktop, Pixel 5 and iPhone 13, plus `home-overview`, `d0-retired-navigation` and the review walk: 60 cases pass on the first attempt. Production build budgets are unchanged. |
| Budgets, matched to main `fea63da7a` | First-load JS 1,685 KB (main 1,679 KB). Shell 434 KB, root CSS 557 KB and first-load CSS 641 KB are unchanged. Standalone output 7,788 files and 194,823,282 bytes (main 7,784 and 194,798,946). No responsiveness change is claimed. |

Hosted CI for the PR head is recorded on the PR and on #6403, not in this file.

**Continue and the overview overlap.** With Continue restored, Home lists the same recent sessions twice: once as overview rows and again as Continue cards below the composer. Retiring Continue, or narrowing what the overview shows, is a product decision for Val.

**Pre-existing defect found by the walk.** Browser Back from Settings to Home leaves the address at `/` but keeps Settings on screen. It reproduces on main `fea63da7a` through the existing Cmd+, shortcut, so it predates this change. The Overview's "Connection settings" action follows the same path. `clearModeParam()` in `src/lib/workspace-url-state.ts` replaces the Home history entry's state with `null`, and Next's router ignores a popstate whose state is `null`. Returning through navigation works.

## 7 November candidate record

Historical status: prepared locally for review, uncommitted, no D0 PR. Canonical outcome: [#6403](https://github.com/OpenCoven/coven-cave/issues/6403) under #6396. This packet complements the [full acceptance audit](ACCEPTANCE.md) and [source/adoption record](README.md); it does not close either issue or qualify an installed client.

## Candidate and scope

Build `rma4i2D7Gu_Ba-8qzZdoH` incorporates main `c03576014863a54ad31d17f6628f105d83a77ab3`, T1 #6410 at `9b30a48b0e94005fdd8c9c660ae56f1981697d93` and canonical T2 #6408 at `3426588f7b7eccd155fd286adf3a2ff6449849cc`. The dependency-only comparison tree is `8e90bf9f0ea2e1cf49817526eed256cdf48dcf0b`: the exact T1/T2 comparison tree plus seven disjoint current-main blobs/modes, with an identical dependency diff proved, not a commit, delivered main, owner approval or either dependency's PR-head qualification. The staged contents, branch and HEAD are unchanged by patch preparation; the worktree HEAD remains `29ed5f5a61b5fcff90132bce31a7da9bbaf92e4b` pending publication authority. Current-main code was incorporated without a commit or merge.

D0 adds a scoped Home overview from existing authorized session/connection reads, retains the composer and exact conversation navigation, and refines the existing inline Activity summary's accessible description and static status icon. It adds no operational control, receipt synthesis, new authority, poller, identity store or execution ledger. The current document owns unsent Home files and pending reads across client navigation; the existing text cache flushes its latest tail on page exit. Focus restoration follows a removed control into its new section, while a deliberate blur of a connected control remains respected.

The inspected design snapshot remains HTML v8 / CSS v12 / JS v9, Nov 3, from the supplied ZIP. The retained archive and source/preview/data copies preserve exact bytes and the D3 license. Preview data and CSS remain documentation only. Live Claude artifact-head equivalence is unknown.

## Final local evidence

| Evidence | Result and scope |
| --- | --- |
| Production profile | Build-time room/craft/recommendation overrides explicitly unset; isolated browser-server values use defaults. A familiar matching all room roles sees Research Desk and Chart Room, while Coding Desk, Writing Desk, Archive and non-opted-in X Comms remain absent. Core navigation and installed-capability access remain. |
| Chromium | 54 D0 regressions plus one production-room/Research-entry probe pass, one worker, zero retries/skips. Research entry and Home draft return are qualified; the captured Research body says not installed, so no mission execution or package readiness is claimed. |
| WebKit | Four actual Home focus cases pass: focused row/action retention across section movement and deliberate blur across in-place/section updates. This is WebKit 26.5 / revision 2336 engine evidence, not Tauri, iOS or human VoiceOver acceptance. |
| App/API | The current-main app gate is being rerun after the unchanged Glitter Crypt short-tap assertion failed following 798 passing files. Its isolated rerun passes; the first failure is retained. The prior-base 1,500-file pass and native-supervisor skips do not substitute for this new run. The earlier 610-file API gate retains identical affected API/server bytes, and current browser checks exercise compiled retired handlers. |
| Design and build | Full lint, build TypeScript, budgets, 2,225-file test wiring, UI consistency, handoff ledger and diff checks pass. Existing undefined-token baseline remains 30. Root CSS 557 KB; first-load CSS 640 KB; standalone 7,779 files / 194,771,417 bytes. |
| Reading and captures | Forty final captures inspected. Three older-reading profiles retain zero-pixel anchor/scroll movement. Sampled Home contrast minima are 5.205:1 Coven dark, 7.344:1 Coven light and 7.542:1 Tide dark, with opaque panels and reduced-motion/transparency checks. |
| Source binding | 110-path code/test/runner tuple `ed12cfa3ecfeeb7777a56053184e3aa22c456d5fb9475ace9d72aab7f0e478dd`; captures `9c83f38ba7469bd7c2fa362ec02dce06e643ad86d92a061b18786f7553fb731e`; measurements `0cd26c460f40c6e0b175988a90faf1f463fb93c9ba1b3dbf93b3785e08b1a703`. |

Exact commands, tuples, runtime configuration, final reports, captures and first failures are retained in the owned worktree at `artifacts/issue-6403/delivery-audit/`. The current source tuple includes the hydration/SSE fixture corrections and all six current-main code/test paths, with unchanged D0/T1/T2 production bytes. Nine captures are byte-identical to already-inspected captures; all 31 changed captures were inspected again. Current render assertions require exactly one visible Overview, without selecting an arbitrary first copy or suppressing page errors.

## Design-language section 9 review

| Shipping item | D0 evidence |
| --- | --- |
| Tokens and themes | Component-imported CSS uses existing tokens; no foundations/theme/token baseline changed. Actual Coven dark/light and Tide dark samples pass. |
| Shared primitives | Existing Button, Icon, RelativeTime and native details/summary are reused; no competing Modal/Popover implementation. |
| Chrome | Three persistent Overview actions; exact row references and conversation actions open on demand. |
| Empty/loading/error | Scope-pending, stale, partial, unavailable, denied and unknown states remain explicit, with refresh, connection settings, conversation or composer next steps. |
| Announcement/focus/motion | Attachment changes announce through the existing live region; focus rings, nested Escape and focus return pass. The confirmed intentional-blur regression is fixed without removing relocation focus. |
| Narrow panes and loading | Container query, Home-only lazy component and budget checks retained; the 390px composer and receipt-limit copy are reachable above fixed navigation. |
| Copy | Sentence-case actions, canonical lifecycle words, exact references, clock preferences and explicit unavailable receipt/binding copy. |
| Contracts | Home model, existing shell/source contracts and actual consumer regressions remain registered and pass. |

## Owners, remaining gates and proposed publication

| Owner / boundary | Imperative next step |
| --- | --- |
| D0 / Val | Authorize the scoped commit, push and draft-PR publication once the prepared patch is approved. Preserve exact T1/T2 commits and their owners; qualify the resulting actual PR head. No merge is authorized by this packet. |
| T1 #6410 / T2 #6408 | Preserve both open PRs and their contributors. Reconcile D0 to the actual delivered dependency tree before final review/merge; the synthetic comparison tree is not that evidence. |
| #5761 / #5762–#5767 owners | Supply scoped producer/reconnect/receipt/privacy evidence for the paths D0 claims, or retain the explicit unsupported/unavailable disposition. D0 consumes the existing contract and does not close or duplicate the whole program. |
| #6358 Cody / Lucian / Charm | Review the current Home/inline captures and remaining numbered backlog through their original roles. No #6358 item, replacement asset or visual approval is superseded by D0's local fixture results. |
| #6200 recovery owner | Continue the separately owned Modal consumer/native matrix and decisions. D0 preserves those sources and uses existing inline disclosure paths. |
| Native / human acceptance | Record exact packaged/native/physical-device and human VoiceOver/visual observations separately. Current WebKit/Chromium results cannot substitute for them. |

Accepting reload discards in-memory Home file bytes; crash and native close/quit file persistence remain unqualified. Protected commit receipts, exact connected-instance binding and governed identity revision remain unavailable from consumed reads. Broader producer/notification/transport privacy acceptance remains separate from the tested consumer boundaries. Retain all first failures, the complete acceptance table and the owned worktree; no commit, PR, merge, release, closure or retirement is claimed.
