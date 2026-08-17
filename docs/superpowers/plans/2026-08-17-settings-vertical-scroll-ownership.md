# Settings Vertical Scroll Ownership Implementation Plan

**Goal:** Make the Settings content pane scroll vertically within its fixed viewport in standalone and embedded modes.

**Architecture:** The existing Settings content main owns vertical overflow. The root must establish the flex column that bounds it.

### Task 1: Pin the Settings scroll boundary

- [x] Add a contract that requires the root's standalone/embedded height branch plus `flex`, `flex-col`, and `overflow-hidden`, without coupling to unrelated class ordering or tokens.
- [x] Require the `min-h-0 flex-1` body and `settings-shell__content min-h-0 flex-1 overflow-y-auto` main.
- [x] Add `flex` to the Settings root immediately before `flex-col`.
- [x] Verify with the focused Settings contract, typecheck, lint, app/API suites, test wiring, end-to-end coverage, and `git diff --check`.
