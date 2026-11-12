# Goldens 13 and 15: browser, packaged-sidecar and real-route rows (2026-11-12)

Supports [#6066](https://github.com/OpenCoven/coven-cave/issues/6066) (golden-15,
preference and legacy transcript hydration) and
[#6061](https://github.com/OpenCoven/coven-cave/issues/6061) (golden-13,
split-secret privacy) under the
[#5767](https://github.com/OpenCoven/coven-cave/issues/5767) gate. It adds to the
[2026-10-18 packet](../runtime-activity-2026-10-18/README.md) and replaces
nothing in it.

**No support claim is made.** Each row below is passed, failed or omitted, with
the build it ran on. Golden-14 ([#6064](https://github.com/OpenCoven/coven-cave/issues/6064))
is held by another session and is not covered here.

## Candidate and identities

| | |
| --- | --- |
| Admitted candidate | `58f015cd9144bad54bce4d720667f9daf27711d0`, tree `52336ac95e9b2959e97ad0521d006ae9024c1ec0`, built from an unmodified clone |
| Branch base | `db435727c55fbdc3c4d432f6121f0754b3989fdc` (`main` on 2026-11-12), 118 commits after the candidate |
| Host | macOS 27.2.1 (26B131) arm64, Node v24.22.0, pnpm 10.34.0, Playwright 1.62.0 |
| Next | 16.3.8 on the candidate, 16.4.3 on the branch |
| Packaged sidecar | `bash scripts/sidecar-bundle.sh` on the candidate: 8,899 files, 147,950,673 bytes, bundled Node v24.22.0 |
| State | Fixture homes from `playwright.config.ts`; the sidecar also ran with a scratch `HOME`. Nothing under `~/.coven` was read or written |

Val's nomination of `58f015cd9` still governs these goldens. `51ea27f66` was
adopted for #6071 only. Rows marked "branch" are development evidence and do
not transfer to the candidate.

Two facts bind earlier receipts to the candidate:

- `tests/chat-activity-acceptance.spec.ts`, its fixtures and the reasoning
  preference sources are byte-identical at the candidate and at the branch base.
- PR #6228's reviewed head `0e150c14b` is not the candidate's tree: two commits
  landed on `main` between them. They touch no reasoning, transcript or iOS
  file, and the `apps/ios` tree is the same object at both
  (`4fa3cf53f243a8c53ccc513b8b61550812967451`). The native receipts in #6228
  therefore cover the candidate's iOS sources; its browser receipts are
  superseded by the runs below.

## Harness added by this packet

| File | Purpose |
| --- | --- |
| `tests/qualification/playwright.golden.config.ts` | The repository config with two projects, Chromium and the WebKit engine, on the same production build. Retries are 0 |
| `tests/qualification/playwright.golden-sidecar.config.ts` | Starts the packaged sidecar the way the desktop shell does (bundled Node, `server.mjs`, `COVEN_CAVE_BUNDLE=1`, a launch token) and runs the same specs against it |
| `tests/chat-activity-legacy-history.spec.ts` | Stores a legacy turn through the real conversation route and reads it back through the real route, display projection and search |

```bash
CI=true COVEN_CAVE_PORT=3142 pnpm exec playwright test \
  --config tests/qualification/playwright.golden.config.ts \
  --grep 'reasoning preference|reasoning toggle during streaming|tool payload sentinels|stored legacy transcript'

bash scripts/sidecar-bundle.sh
CI=true COVEN_CAVE_PORT=3142 GOLDEN_SIDECAR_HOME=/absolute/scratch/dir pnpm exec playwright test \
  --config tests/qualification/playwright.golden-sidecar.config.ts \
  --grep 'reasoning preference|reasoning toggle during streaming|tool payload sentinels|stored legacy transcript'
```

The sidecar config is the packaged server and client bundle in a browser
engine. It is not the Tauri window: the shell's WKWebView, its IPC bridge and
the URL-token handoff are not exercised, and the harness presents the sidecar
token as a request header.

Every run, with its command, identities, per-test outcome and the SHA-256 of
its raw log and report, is in [browser-receipts.json](browser-receipts.json).
The raw files stay outside the repository.

## Golden-15 rows

"Hydration matrix" is ten tests: typed and legacy-fixture transcripts under an
absent, `0`, `1` and unrecognized saved preference, sampled on every animation
frame for a flash, plus hiding thinking while a reply streams and then
reloading.

| # | Row | Candidate `58f015cd9` | Branch | Result |
| --- | --- | --- | --- | --- |
| 1 | Hydration matrix, production build, Chromium, route fixtures | 10 of 10, first attempt (`cand-58f015cd9-r1`) | 10 of 10 (`head-db435727c-r1`) | **passed** |
| 2 | Hydration matrix, production build, WebKit engine, route fixtures | 10 of 10, first attempt (`cand-58f015cd9-r1`) | 10 of 10 (`head-db435727c-r1`) | **passed** |
| 3 | Hydration matrix, packaged sidecar, Chromium | 10 of 10 on both runs (`cand-sidecar-r1`, `-r2`) | not run | **passed** |
| 4 | Hydration matrix, packaged sidecar, WebKit engine | 6 of 10 failed on `cand-sidecar-r1`; 10 of 10 on `cand-sidecar-r2` | not run | **passed** after a harness correction (below) |
| 5 | Stored legacy turn through the real conversation route, production build, both engines, four preferences: answer kept, no reasoning shown, no flash, saved choice untouched | 8 of 8 (`cand-legacy-route-r1`; spec copied in from the branch) | 8 of 8 (`head-legacy-route-r1`) | **passed** |
| 6 | The same through the packaged sidecar's real route and store | 8 of 8 (`cand-sidecar-legacy-route-r1`) | not run | **passed** |
| 7 | Chat search over the same stored legacy turn never matches or quotes the withheld reasoning | **8 of 8 failed** (`cand-sidecar-legacy-route-search-r1`) | 8 of 8 (`head-legacy-route-search-r1`, with the fix) | **failed on the candidate**; fixed on the branch (finding 2) |
| 8 | Native preference hydration on a typed transcript, simulator | #6228's `AgentActivityUITests` receipt, 14 of 14, on the identical `apps/ios` tree. Not re-run here | not run | **retained receipt**, not new evidence |
| 9 | Native legacy transcript | not run | not run | **omitted**: the iOS client has no `<thinking>` handling and depends on the server projection that rows 5 and 6 exercise. A phone paired with a server older than `176351b30` (2026-10-04) would show the raw tags; that pairing was not tested |
| 10 | Packaged Tauri window (WKWebView, IPC bridge, URL-token handoff) | not run | not run | **omitted**: the repository has no automation that drives the shell on macOS. Needs a human pass or new shell automation |
| 11 | Physical phone, VoiceOver, human acceptance | not run | not run | **omitted**: needs a device and a person |

### First failures, kept as they happened

- **`cand-sidecar-r1`: 7 of 11 WebKit tests failed against the packaged
  sidecar** (6 hydration, 1 golden-13). After a reload the page reported that
  it could not reach the daemon, which means the spec's API fixtures were no
  longer applied. The app registers its PWA service worker in a plain browser
  and skips it inside Tauri (`src/components/pwa-register.tsx`). Against this
  server the worker installed and took over the page. `cand-sidecar-r2` changed
  one thing, `serviceWorkers: "block"`, which is what the shell does, and all
  22 passed. That one-variable change is the evidence for the cause; the worker
  was not inspected directly. No timeout or retry was changed.
- **`head-legacy-route-probe-mutated-r1-build-error`: the first non-vacuity
  probe never ran a test.** The mutation left an unused import and the build's
  typecheck stopped it. The second mutation compiled.

### Non-vacuity of the new spec

The spec passed on its first run, so it was run once against a server whose
legacy projection was disabled (`turn.text` served as stored). All 8 tests then
failed at the API assertion, and a page-only copy with the API assertions
removed failed 8 of 8 at the per-frame sampler
(`head-legacy-route-probe-mutated-r2`). The mutation was reverted.

## Findings

1. **On the production path, legacy reasoning is withheld, not hidden behind
   the preference.** Since `176351b30` the server removes the content of legacy
   `<thinking>` and `<reasoning>` tags from history and from the live stream
   (`src/lib/server/legacy-reasoning-projection.ts`). No client receives it, so
   the saved preference has nothing to show or hide for a legacy turn. The ten
   "legacy" fixture tests in rows 1 to 4 fulfil the history request themselves:
   they prove the web client's fallback for a payload the current server does
   not send. Golden-15 asks that "existing content" be preserved. The answer
   is; the legacy reasoning is not shown. Whether that satisfies the golden is
   a disposition for Val.
2. **Chat search quoted the withheld reasoning.** `searchConversations` matched
   and built its snippet from the stored turn, so text the transcript withholds
   appeared in chat-list and command-palette results. Reproduced on the
   candidate's packaged sidecar (row 7). Fixed on the branch: search now applies
   the same projection to assistant turns, with a failing unit test first
   (`src/lib/cave-conversations.test.ts`). A user's own literal tags stay
   searchable.
3. **Route-fixture specs are unreliable on WebKit against any server that lets
   the service worker install.** The CI production server is not affected in
   the runs above. Specs that must run that way should block service workers,
   as several already do.

## Checks on the branch with the search fix

`pnpm test:api` (616 files) and `pnpm test:app` (1,509 files) passed under an
isolated `HOME`, as did `pnpm typecheck`, `pnpm lint` and
`pnpm check:tests-wired`. The new spec also passed under the repository's own
`playwright.config.ts` with `CI=true` and the `desktop` project, which is how
hosted CI runs it.

## Not covered

Golden-14, real-provider turns, the Tauri window, physical devices, VoiceOver,
and any server older than the candidate. The branch rows ran on a base that is
not an admitted candidate.
