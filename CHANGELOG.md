# Changelog

All notable changes to CovenCave land here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). CovenCave uses
[SemVer](https://semver.org/) while still in 0.x — minor releases may carry
breaking config changes; patch releases stay additive.

## [Unreleased]

## [0.0.58] — 2026-06-09

Accessibility sweep across the main interactive surfaces (kanban,
calendar, board, library, terminal mirror, glyph picker, avatar rail,
familiar studio, browser quick-open), two new themes to broaden the
default palette, and a couple of recovery fixes.

### Added

- **Two new default themes.** Hex (true red, hue 25°) — *"Bloodletter's
  brand. The mark that doesn't wash off."* — fills the red slot Bloom's
  rose-pink didn't cover; deeper base and ~3× higher background chroma
  than Bloom keep them visibly distinct. Bane (lime green, hue 125°) —
  *"Wolfsbane bloom. Bright; deeply unwise."* — fills the lime slot
  Grove's mossy 150° forest didn't cover. `THEME_IDS` count bumps
  from 8 → 10. (#295)
- **Keyboard drag on kanban cards.** Cards can be picked up, moved,
  and dropped without a pointer: Space to grab, arrow keys to move,
  Space or Esc to commit or cancel.
- **Calendar TimeGrid event roving.** Arrow-key navigation across
  event blocks in the calendar time grid, with Enter to open.
- **Board table vertical roving + Enter/Esc.** Arrow keys traverse
  the board cells; Enter opens, Esc dismisses.
- **Library reader heading navigation.** `j` / `k` and arrow keys
  walk between headings inside the reader pane.
- **XTerm screen-reader mirror.** The embedded terminal now exposes
  a parallel screen-reader-accessible mirror of its scrollback so
  AT users can read terminal output line by line.
- **Familiar studio tablist + vertical roving tabindex.** Keyboard
  traversal across the studio's tab strip and the vertical sections
  inside each tab.
- **Avatar rail vertical roving tabindex.** Up/down arrow navigation
  through the leftmost familiar avatar rail.
- **Glyph picker horizontal roving + scrollIntoView.** Left/right
  arrows through the glyph grid; selected glyph scrolls into view.
- **Browser quick-open listbox semantics.** Quick-open results are
  now a proper `role=listbox` so screen readers announce position
  and total.

### Fixed

- **Conversation history writes are validated.** Chat now guards
  against writing malformed history entries to the local conversation
  store, preventing corruption that previously surfaced as missing or
  reordered messages on reload.
- **Onboarding stays open after completion.** Setup no longer
  auto-dismisses the moment its final step succeeds — users see the
  confirmation state and close it themselves.

### Changed

- **CHANGELOG accuracy.** The v0.0.57 CHANGELOG entry was corrected
  to list the actual eight theme names (Coven, Tide, Grove, Ember,
  Bloom, Dusk, Mist, Slate) and to record PR #290's Ember-light
  contrast fix in the Fixed section. The shipped v0.0.57 tag and
  artifacts are unchanged; only the CHANGELOG file on main was
  updated. (#292)
- **Repo hygiene.** `.superpowers/` contents are no longer tracked —
  they're per-user agent specs and don't belong in the working tree
  on main. (#293)

## [0.0.57] — 2026-06-09

Theme personality, recovered local chats with familiar-scoped memory,
and a small PTY guard.

### Added

- **Expanded memory reader.** Memory inspector exposes a fuller
  per-file reader so longer entries stay legible inside the panel
  instead of clipping at the rail. (#287)

### Changed

- **Distinct theme personalities.** The eight default palettes
  (Coven, Tide, Grove, Ember, Bloom, Dusk, Mist, Slate) now carry
  their hue in the chrome — background chroma is pushed 2–4× and
  base lightness is staggered, so each theme reads as a different
  mood (lavender grimoire, moontide blue, hexenwald moss, brazier
  parchment, bewitching rose, witching-hour magenta, scrying-pool
  teal, ink-and-bone) instead of the previous flat dark/light gray
  with only a tinted accent button. (#285)

### Fixed

- **Local chat recovery + familiar-scoped memory.** Chats stored in
  the Cave-local conversation store are now recovered into the
  session list when the daemon is offline, and the familiar memory
  view is scoped to the active familiar so other familiars' files no
  longer bleed into the surface. (#287)
- **Ember light contrast.** Pulls Ember light background chroma back
  and darkens the burnt-orange accent so body text reads cleanly on
  the parchment surface; foreground and muted-foreground lightness
  tightened to match. Ember dark untouched. (#290)
- **PTY zero-size guard.** Clamps PTY dimensions to a safe minimum
  when the host terminal pane reports a zero-pixel area, preventing
  the desktop from crashing when chat or terminal panes are collapsed
  to nothing.

## [0.0.56] — 2026-06-09

Cross-surface polish, memory provenance + a11y groundwork, and a
standardized release-notes pipeline. No public-API breaks.

### Added

- **Memory file source metadata.** `/api/memory` now exposes per-file
  `source` and `context` provenance so the inspector and the 3D graph
  can surface where a memory entry originated. (#278)
- **API contract test suite.** Sanity-checks the surface area of the
  workspace-driving routes so future refactors can't silently break
  callers. (#277)
- **Accessibility quickwins.** Focus rings, ARIA labels, and keyboard
  traversal repaired across the agents, inspector, capabilities, and
  command-palette surfaces. (#280)

### Fixed

- **Inspector pane surface.** Inspector now matches the compact rail
  surface tokens instead of drifting on its own palette. (#273)
- **Familiar memory file reads.** The packaged sidecar can now read the
  per-familiar memory tree it was previously refusing. (#274)
- **Agents hover caret + memory tab scroll.** Roster card name + the
  agents-detail memory tab no longer show a hover caret, and the memory
  tab scrolls within its detail panel instead of pushing siblings
  off-screen. (#275, #276)
- **Salem surface tokens.** Salem perch and chat panel inherit shared
  Cave tokens (`--bg-panel`, `--accent-presence`, `--text-*`) instead of
  hardcoded purple literals — theme tuning now reaches the rail and
  perch consistently. (#279)
- **Settings reported app version.** About / settings now reports the
  version embedded in the bundle metadata instead of a stale literal.
- **Chat header context row.** Chat keeps its context row inside the
  header instead of letting it reflow below on tighter viewports.

### Changed

- **Standardized release notes.** New `scripts/release-notes.sh` renders
  a consistent GitHub Release body (CHANGELOG section + arch-aware
  install block + checksum verify snippet + compare link), wired into
  `release.yml`'s checksums job. Backfilled all 24 historically-empty
  release pages (`v0.0.23`–`v0.0.55`) with the standardized template.
  (#282)

## [0.0.55] — 2026-06-08

Release repair for the packaged macOS sidecar after 0.0.54.

### Fixed

- **Loopback-tolerant referer check.** The sidecar's CSRF guard now treats
  `127.0.0.1`, `localhost`, and `[::1]` as the same origin when scheme and
  port match. Tauri's WKWebView on macOS sends a referer whose loopback
  hostname can differ from the one the sidecar bound to (e.g. webview
  loaded at `http://127.0.0.1:<port>/`, request comes in with
  `Referer: http://localhost:<port>/…`), which made every `/api/…` call
  fail with `forbidden referer` once the sidecar successfully booted on
  Apple Silicon. The loopback host gate and token check still run first,
  so the relaxation only widens what counts as "same origin" inside the
  already-loopback envelope.

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
