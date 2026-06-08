# Changelog

All notable changes to CovenCave land here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). CovenCave uses
[SemVer](https://semver.org/) while still in 0.x — minor releases may carry
breaking config changes; patch releases stay additive.

## [Unreleased]

This release rolls up the Familiar Studio work, the shell IA redesign that
preceded it on `main`, and a sweep of production-readiness fixes from the
internal audit.

### Added

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

### Fixed

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

### Known limitations

- `screenshots/*.png` predate the avatar rail + companion rail IA and
  the Familiar Studio drawer. Refresh before the next tagged release.
- `release/` still ships only `CovenCave-v0.0.48.dmg`. Tagging requires
  rebuilt `.dmg` / `.msi` / `.AppImage` artifacts plus SHA256SUMS.

---

Earlier releases are tracked only by tag on
[GitHub Releases](https://github.com/OpenCoven/coven-cave/releases).
This file starts at the Familiar Studio cut.
