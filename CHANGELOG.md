# Changelog

All notable changes to CovenCave land here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). CovenCave uses
[SemVer](https://semver.org/) while still in 0.x — minor releases may carry
breaking config changes; patch releases stay additive.

## [Unreleased]

## [0.0.54] — 2026-06-08

Release repair for macOS sidecar startup after 0.0.53.

### Fixed

- **Signed macOS sidecar Node startup.** Re-signs the bundled Node runtime with
  the hardened-runtime executable-memory entitlements V8 needs, so the packaged
  sidecar can bind its local port instead of crashing before producing server
  output. Thanks @BunsDev
- **Native Apple Silicon DMG.** Adds an `macos-15` (aarch64) leg to the release
  matrix alongside the existing `macos-15-intel` (x86_64) leg and tags each
  produced DMG with its arch suffix (`-x86_64.dmg`, `-aarch64.dmg`). M-series
  Macs no longer run the bundled Node through Rosetta, where V8 baseline-JIT
  tier-up could crash the sidecar before it bound its port.

## [0.0.53] — 2026-06-08

Release repair for clean CI packaging after 0.0.52.

### Fixed

- **Clean release resource staging.** Tracks minimal placeholder files for the
  generated server and bundled Node resource trees so Tauri validates resource
  globs on clean Linux and Windows release runners before the sidecar bundler
  replaces them with real packaged contents.

## [0.0.52] — 2026-06-08

Release repair for 0.0.51.

### Fixed

- **Packaged sidecar startup.** Bundles the Node runtime into release artifacts
  and generates the standalone Next.js sidecar immediately before Tauri
  packaging, so fresh installs no longer depend on a user-installed Node binary
  or ship placeholder-only sidecar resources.
- **Packaged workspace/daemon status.** Stops overriding Cave's Coven workspace
  with the OpenClaw workspace in packaged mode, and prefers the npm-installed
  `coven` CLI over stale Rust-installed binaries when resolving daemon helpers.

## [0.0.51] — 2026-06-08

Small stopping-point release for the CovenCave polish wave after 0.0.50.

### Added

- **Salem docs familiar.** Adds Salem as a bottom-right 3D black-cat docs
  familiar with a quiet perch, expandable docs chat, preloaded docs/tool/skill
  context, Cave route awareness, and he/him Sabrina-style sassy persona
  guardrails.
- **Collapsed transcript internals.** Thinking and tool activity now stay
  collapsed by default, including individual tool input/output payloads, so
  the assistant reply remains the first thing users read.

### Changed

- **Linear chat polish.** Chat layout now runs full width with denser turn
  numbering, cleaner metadata, themed ThinkingIndicator colors, send-button
  hover repair, and stronger focus rings.
- **Dark Cave visibility.** Lifts the default dark background slightly and
  tunes Salem's material/rim light so his black-cat silhouette remains visible
  without turning into a glow blob.

### Fixed

- **UI contrast and focus pass.** Repairs focus rings, hover states, and
  eyebrow/label contrast across Settings, Familiar Studio, Plugins,
  Onboarding, Calendar, Capabilities, and chat surfaces.
- **Salem chat surface.** Removes emoji glyphs from the open chat panel while
  keeping the 3D Salem presence in the perch and header.

## [0.0.50] — 2026-06-08

Agents page, light/dark themes, full UI polish pass, memory constellation
with per-familiar file coverage, reader improvements, chat surface controls
cleanup, and a handful of chat rendering fixes.

### Added

- **Agents page.** New default landing surface with a roster grid of all
  familiars, in-place drill-in with Memory / Files / Sessions tabs, and a
  "Memory across all agents" overlay. Sidebar gains an Agents folder;
  ⌘1–⌘8 shortcuts shift accordingly.
- **Light / dark mode + 8 themes.** Full `prefers-color-scheme` aware
  theme system with curated Midnight, Dusk, Slate, Moss, Sky, Dawn, Latte,
  and Storm presets. All hardcoded `rgba(255,…)` color literals replaced
  with `var(--text-*)` / `var(--bg-*)` / `var(--border-*)` tokens.
- **Memory constellation — per-familiar file coverage.** `/api/memory`
  now scans `~/.openclaw/workspace/<familiarId>/memory/` for every agent
  and tags each entry with `familiarId`. The 3-D graph model renders them
  as a files sub-hub connected to each familiar's hub node (~1 200 entries
  across all familiars vs 1 before).
- **Research Library reader polish.** Lora font imported, modal widened
  from 780 → 820 px, airy header and body padding, Lora prose at 16 px /
  1.85 line-height.
- **Cave marketplace (tier 0).** Preserve tier-0 marketplace surface.
- **Familiar Studio drawer.** Per-familiar Cave-local customization with four
  tabs: Identity (display name, role, pronouns, description), Look (glyph
  picker, accent color, uploaded image avatar), Brain (harness / model / note
  via `PATCH /api/config`), and Lifecycle (archive, reset, list view).
- **FamiliarAvatar.** Unified avatar component that picks between an
  uploaded image, a Cave-local glyph override, the daemon-supplied icon, a
  role-inferred glyph, or `ph:sparkle-fill`. Replaces direct `<FamiliarGlyph>`
  usage at 13 consumer sites.
- **Cave-local stores.** `cave-familiar-overrides`, `cave-familiar-images`,
  `cave-familiar-archive`, and `familiar-resolve` provide layered resolution
  of daemon + cave state, all persisted in localStorage with
  `useSyncExternalStore` re-renders and cross-tab `storage` events.
- **Rail polish.** Per-familiar accent ring, hover edit affordance,
  right-click → Studio, drag-to-reorder via the existing order store.
- **Settings · Familiars panel** now surfaces an Edit button that opens
  Studio for the selected familiar.

### Changed

- **Chat surface controls.** Session toggle renamed Open/Closed → Active/Done
  with status icons; group-by option renamed None → Flat; rows icon prefixed
  to the group-by segment for visual context.
- **Chat workbench.** `cave-chat-workbench`, `cave-chat-workbench-header`,
  `cave-chat-thread`, `cave-chat-empty` CSS classes replace inline style
  attributes. ToolGroup summary label changed "Tool use" → "Tool activity".
- **UI polish sweep.** Sidebar, header, banner, rail, board, inbox, and
  library all received focus-ring corrections, light-mode theming, and
  contrast improvements.
- **Library timeline.** Stable `timelineEntryKey()` prevents `key=undefined`
  React warnings on legacy entries missing `.id`.
- **Session list controls.** Session filter tab and group-by toggle visual
  improvements; `.gitignore` updated to exclude `.playwright-cli/` dumps.
- **`callDaemon`** normalizes socket errors. ENOENT/ECONNREFUSED →
  `"daemon offline"`, EACCES/EPERM → `"socket exists but not readable"`,
  timeouts → `"daemon timeout"`. Other errors have absolute paths redacted
  so the UI never leaks `/Users/<name>/.coven/...` in offline polls.
- **`callDaemon`** now rejects a non-empty body that fails `JSON.parse` with
  `{ok: false, error: "malformed response"}` instead of silently returning
  `data: null`. Daemon misbehavior is observable to callers again.
- **`socketPath()`** is now evaluated per call. Mid-session `COVEN_SOCKET`
  env changes take effect without an app restart.
- **`familiar-glyph` precedence** gains a role-keyword inference step
  (`code`, `chat`, `music`, `research`, `art`, `data`, `ops`, `writer`,
  `designer`) between the daemon emoji and the default `ph:sparkle-fill`.
  Matched via word-boundary regex so "Chart analyst" doesn't accidentally
  pick the art-palette glyph.
- **Inbox & Board** demo-mode seeding now only fires when the API returned
  `ok: true` with an empty list. Real API failures render the error and
  empty state instead of being silently masked by `DEMO_*` fixtures.
- **Phone-class viewport (<768px)** collapses the shell to a single
  pane. Avatar rail becomes a horizontal top strip with overflow
  scroll, sidebar nav / list / companion rail hide (⌘B / ⌘\\ / ⌘J
  still flip the React state for keyboard recall), detail panel
  takes the full width, Studio drawer height switches to 100dvh so
  the iOS keyboard doesn't clip its tabs.

### Fixed

- **Chat markdown rendering.** Re-attached `lang:filename` label, corrected
  multi-block render, stripped lang suffix before parse, surfaced render
  errors with aligned HTML escape.
- **Chat history.** Preserved history and context across session transitions.
- **Superpowers skill bodies.** Hidden leaked skill body content from chat;
  plugin row padding deduplicated.
- **Title enricher.** Stopped arbitrary server-side URL fetches that could
  leak internal paths.
- **Agents memory routes.** Wired memory routes correctly to the Agents
  surface.
- **CSRF gate ordering.** `src/proxy.ts` previously short-circuited to
  `NextResponse.next()` the moment `COVEN_CAVE_AUTH_TOKEN` was unset
  (the typical `pnpm dev` state). That early return ran *before* the
  loopback / same-origin / referer / content-type checks, so anything
  reachable on the dev server's port could call workspace-driving routes
  unauthenticated. Reordered so the CSRF guards always apply to `/api/`
  requests; only the token equality check is skippable in browser-dev
  mode. Pinned by an ordering assertion in `middleware.test.ts`.
- **Onboarding silent failure.** `/api/onboarding/status` poll failures
  used to be caught and discarded — six step cards stayed on
  "checking…" forever for a fresh user without the `coven` CLI. After
  three consecutive failures the overlay now renders a `role="alert"`
  banner with a Retry button while the step cards remain visible.
- **Familiar glyph input.** The first-run "Glyph" field accepted any
  free text, so typing "robot" wrote an unrenderable value into
  `familiars.toml`. Now validates `ph:`-prefix inline with red border,
  `aria-invalid`, and a hint to phosphoricons.com; both create buttons
  refuse to submit until the value is valid.
- **Library load failures.** `LibraryView` swallowed every error in the
  docs fetch path, so empty / API-errored / network-blip all rendered
  identical "No documents found." `LibraryDocList` now exposes
  `error` + `onRetry` props and renders a `role="alert"` block with a
  retry affordance when the load fails.
- **Board empty state.** A board with zero cards used to show empty
  kanban columns with no CTA — the "+ New task" button at the top was
  the only hint. Added a centered "Queue your first task" hero that
  appears only while `cards.length === 0 && !error`.
- **Memory empty copy.** When `/api/coven-memory` failed,
  `AgentsMemoryView` showed the error in a header banner but the body
  empty-states still read "No memories match this view," contradicting
  the warning. Body copy now mirrors the error state.

### Removed

- **Dead code.** `src/lib/mobile-access-token.ts` and its test referenced
  `COVEN_MOBILE_ACCESS_TOKEN` and helpers that nothing imported — the
  actual mobile gate in `src/proxy.ts` uses `COVEN_CAVE_ACCESS_TOKEN`
  and re-implements its helpers inline. Both files deleted.
- **Stale tests.** Five tests that asserted behaviors removed by the
  shell IA redesign (group-by-Familiar dropdown, "Chats as separate
  top-level destination", old sidebar IDs, glyph imports in the
  text-only switcher) were repaired or deleted in `5be5e6b` so the
  baseline is green again.

### Security

- **Loopback / same-origin / referer / content-type** checks now run for
  every `/api/*` request, including when no sidecar auth token is
  configured. Plain `pnpm dev` browser tabs still work (they naturally
  satisfy every guard); LAN-reachable callers and cross-origin requests
  are blocked even in dev mode. See the *Fixed → CSRF gate ordering*
  entry above.

### Internal

- **Cargo version sync.** `src-tauri/Cargo.toml` shipped `0.1.0` while
  `package.json` and `tauri.conf.json` were `0.0.49`. Bumped Cargo (and
  the matching `Cargo.lock` entry for the `app` crate) so the native
  binary's version metadata matches the user-visible build version.
- **Screenshots refreshed** against the new shell IA + Familiar Studio
  via `node scripts/capture-screenshots.mjs`. The capture script also
  picked up the Chat / Board renames and a more robust sidebar selector
  (matches the visible label rather than the full `Board ⌘3` accessible
  name). 3D canvas non-blank verification (`scripts/verify-trace-graph-3d.mjs`)
  passed for desktop and mobile viewports.
- **`scripts/release.sh` writes `release/SHA256SUMS`** automatically
  after each successful build, replacing any prior entry for the
  same artifact in place. README's "Release standard" promise is now
  enforced by the script rather than the operator's memory.
- **`Copy diagnostics`** payload extended with `capturedAt`,
  `statusFailures`, `setupError`, and `agentsError` so support traces
  can answer "daemon unreachable vs setup itself failed?" without a
  follow-up round trip.
- **Proxy helpers extracted** into `src/proxy-helpers.ts` so the
  CSRF / loopback / same-origin / bearer-token / timing-safe-compare
  primitives can be unit-tested directly (`proxy-behavior.test.ts`)
  without paying the `next/server` ESM resolution cost. Pure
  refactor; proxy.ts re-exports the helpers and middleware behavior
  is unchanged.
- **README + docs/mobile-tailscale.md** brought in line with the new
  IA (avatar rail, Familiar Studio, Chat/Board renames) and the
  always-on CSRF guards. Keybinds table expanded for the new
  surface / familiar / chat shortcuts; screenshots section
  references all eight current PNGs.

### Known limitations

- The currently published GitHub Release is still v0.0.48; the next
  tag push will trigger `.github/workflows/release.yml` to build all
  three OS artifacts and publish a `SHA256SUMS` asset alongside them.
  The script + workflow plumbing for that is done; the actual rebuild
  needs a tag push by someone with repo-secret access for the Apple
  signing/notarization credentials.

### Pre-existing artifact checksum

For verifiability while v0.0.49 is in flight, the SHA-256 of the
currently shipped macOS DMG (`CovenCave-v0.0.48.dmg`) is:

```
70bea2f0f0f81a655f356bf4502c19c573449393d1d8653c58be677a6f2f568a  CovenCave-v0.0.48.dmg
```

Verify with `shasum -a 256 -c` against a one-line file containing that
entry. Future releases will ship this aggregated in `SHA256SUMS` via
the workflow.

---

Earlier releases are tracked only by tag on
[GitHub Releases](https://github.com/OpenCoven/coven-cave/releases).
This file starts at the Familiar Studio cut.
