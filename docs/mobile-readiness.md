# Mobile Readiness — Per-Surface Acceptance Checklist

Manual dogfood checklist for the mobile-readiness rollout. Run this on
a real iPhone (iOS Safari) and a real Pixel (Chrome) before merging
`feat/mobile-readiness` to `main`, and again after any phase 4–7
follow-up that touches a covered surface. Automated coverage is
documented at the bottom.

## How to reach the app from a phone

```bash
pnpm mobile:tailscale
```

Prints a short-lived Tailscale Serve invite URL. In the desktop app,
click **Open on phone** in the top bar and scan the QR code instead.
The invite is stored as an HTTP-only cookie after the first successful
request. The phone is only a browser — the daemon still runs on the dev
machine.

Native-Tauri shell on iOS / Android: same daemon-over-Tailscale model;
see `docs/mobile-tailscale.md`.

## Global foundations (phase 1)

- [ ] iPhone Safari: tap any input — no auto-zoom on focus.
- [ ] iPhone Safari, landscape with notch: header content (top-bar,
  settings header) clears the notch. No content under the home
  indicator at the bottom.
- [ ] Reduced-motion enabled in OS: drawer transitions skip the slide.
- [ ] Dark mode + light mode: theme-color meta matches address bar
  background in iOS Safari.
- [ ] Add to Home Screen: app icon shows the lavender Coven mark. App
  launches in standalone display mode (no Safari chrome).

## Shell drawers (phase 2)

- [ ] Tap the ☰ hamburger in the top-bar — nav drawer slides in from
  the left. Tap-outside dismisses. Esc on external keyboard dismisses.
- [ ] Tap the list-checks icon (when on a surface with a list pane) —
  list drawer slides in. Same dismiss paths.
- [ ] Tap the cat icon — agent drawer slides in from the right.
- [ ] ⌘B / ⌘\ / ⌘J on external keyboard still toggle the drawers.
- [ ] No horizontal scrolling at 360px viewport on any surface. (Open
  DevTools, drag the device-toolbar to 360px, scroll-X bar should be
  hidden.)

## Hover → tap (phase 3)

- [ ] Notification bell popover: settings gear visible without
  hovering.
- [ ] Inbox row: checkbox visible without hovering. "Show actions" `⋯`
  visible without hovering.
- [ ] GitHub view row: action button strip visible without hovering.
- [ ] Tooltip on a button: long-press (~500ms) reveals it. Quick tap
  fires the underlying action and no tooltip appears. Tap outside
  dismisses.

## Chat (phase 4a)

- [ ] Tap the composer textarea — keyboard slides up, composer dock
  rides up with it (stays visible above the keyboard, not under it).
- [ ] Compose a long message — composer dock grows but stays anchored.
- [ ] Hit "send" with the keyboard's "Send" key (enterKeyHint) — message
  sends without losing focus.
- [ ] Open a modal (e.g. new reminder) on phone — the title input does
  NOT auto-focus (no keyboard pops on open).

## Inbox + Calendar (phase 4b)

- [ ] Inbox header at 360px: chips wrap to a second line if needed; no
  controls disappear off-screen.
- [ ] Inbox filter chips: scroll horizontally without wrapping; tap
  selects a chip.
- [ ] Calendar: defaults to Agenda view on mobile; toggle group + the
  keyboard hint footer are hidden.
- [ ] Calendar agenda chip: tap area is at least 44×44px (use Safari
  DevTools → element inspection).

## Board (phase 4c)

- [ ] Card-stack view: status filter chips scroll horizontally; tap
  filters the visible sections.
- [ ] Tap a card body → opens the inspector drawer (slides in from the
  right, takes the full screen on phone).
- [ ] Tap the `⋯` button on a card → "Move to" popover. Picking a
  status moves the card; the popover dismisses.
- [ ] Kanban + table toggles in the header are hidden (the desktop
  kanban / table are not reachable on phone — card-stack only).

## Library / Agents / Settings (phase 4d)

- [ ] Settings on phone: first view is a full-screen list of sections
  with right-pointing chevrons. Tap a section → its content fills the
  screen with a "← Settings" back button. Back drops to the list.
- [ ] `/settings#plugins` deep-link goes straight to the plugins
  content (no picker shown).
- [ ] Familiar avatar rail: long-press an avatar then drag to reorder.
  Quick tap selects the familiar instead of dragging.
- [ ] Agents → memory: agenda/list view is the default on phone. The
  3D graph toggle is hidden. The phone doesn't burn battery.
- [ ] Agents memory overlay: opens edge-to-edge (no scrim around it).

## PWA (phase 5)

- [ ] Add to Home Screen → app launches in standalone (no Safari
  chrome). Status bar text is white on the dark theme.
- [ ] First load offline (airplane mode after first online visit) → the
  shell loads, the daemon-offline banner appears. Refresh → still the
  shell.
- [ ] `/api/*` requests offline → fail immediately, not from a stale
  200. Daemon-offline banner reflects.

## Tauri-mobile shell (phase 6)

(Only if you have Xcode / Android Studio installed and have run
`pnpm tauri ios init` / `pnpm tauri android init`.)

- [ ] iOS simulator + Android emulator: app launches, points at the
  configured remote daemon, primary flows (chat, board, inbox) work.
- [ ] Bottom-terminal surface shows the "Terminal is only available
  inside the CovenCave desktop app" placeholder.
- [ ] Browser-pane surface drops to the iframe fallback.
- [ ] First push notification: OS permission sheet appears once; after
  granted, local notifications fire.

## Perf budget (phase 7)

- [ ] DevTools → Network → throttle to Fast 3G → first paint to
  interactive ≤ 4s on the chat route.
- [ ] DevTools → Coverage tab on first-paint of /: confirms the
  Three.js chunks are NOT loaded (they should chunk-split out to
  agents-memory / calls / Salem).
- [ ] Open Salem → Three.js chunk fetches.
- [ ] Open agents → memory list view: Three.js chunk does NOT fetch.
  (Toggle to graph view on desktop → it fetches.)

---

## Automated coverage

| What | Command |
|---|---|
| Mobile-specific Node smoke tests | `pnpm test:mobile` |
| Full unit + smoke + API suite | `pnpm test:app && pnpm test:api` |
| Typecheck | `pnpm typecheck` |
| Production build | `pnpm build` |
| Mobile viewport geometry | `pnpm test:e2e:mobile` |

The mobile smoke set asserts CSS / component invariants (drawer wiring,
no-zoom font-sizes, safe-area tokens) — fast, no browser. Playwright
mobile-viewport specs (`pnpm test:e2e:mobile`) cover the runtime
behaviours that smoke tests can't catch; they boot Next.js + a fake
daemon so they're slower and live in CI rather than every pre-commit.

For release candidates that touch mobile access, also run a real
Tailscale smoke: open **Open on phone**, scan the QR from a phone on the
same tailnet, confirm Chat and Library load, then wait for or manually
refresh an expired invite to confirm the old URL is rejected.

When this checklist is run, paste the date and device list into the PR
description so the next reviewer has a record.
