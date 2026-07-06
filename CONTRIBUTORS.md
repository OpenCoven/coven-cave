# Contributors

CovenCave is built by the OpenCoven team with help from the wider community.
Thank you to everyone who has reported issues, proposed fixes, and shipped
improvements.

## Community Contributors

### Chris Thomas ([@Aimplemented](https://github.com/Aimplemented))

Chris contributed several fixes and improvements that shipped in CovenCave.
His original pull requests were re-landed through internal branches during
merge, so this file records the credit his work is due:

- **Parallel group-chat first-pass replies** — reworked full-coven group chat
  from sequential relay to independent parallel first-pass replies, with
  roundtable prompt framing so each familiar answers from its own role.
  (proposed in [#2187](https://github.com/OpenCoven/coven-cave/pull/2187) /
  [#2188](https://github.com/OpenCoven/coven-cave/issues/2188), shipped in
  [#2206](https://github.com/OpenCoven/coven-cave/pull/2206))
- **Native iOS Serve route stays tokenless** — kept the native iOS Serve
  route reachable without a bearer token so on-device handoff works.
  (proposed in [#2391](https://github.com/OpenCoven/coven-cave/pull/2391) /
  [#2396](https://github.com/OpenCoven/coven-cave/pull/2396), shipped in
  [#2404](https://github.com/OpenCoven/coven-cave/pull/2404))
- **Installer links open through the system handler** — routed fallback
  installer/update CTAs through Tauri `shell_open` so DMG/MSI/AppImage assets
  use the OS browser/download handler, with `window.open` and the Cave Browser
  as recovery fallbacks.
  (proposed in [#2379](https://github.com/OpenCoven/coven-cave/pull/2379),
  shipped in [#2381](https://github.com/OpenCoven/coven-cave/pull/2381) and
  [#2414](https://github.com/OpenCoven/coven-cave/pull/2414))
- **Current session id flag for OpenClaw** — used the current session id flag
  so session targeting resolves correctly.
  (proposed in [#1974](https://github.com/OpenCoven/coven-cave/pull/1974),
  shipped in [#1989](https://github.com/OpenCoven/coven-cave/pull/1989))
