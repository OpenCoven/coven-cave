# Windows window usability implementation plan

Checkbox state is not evidence of completion. Verified code, test receipts, merged PRs and the canonical issue determine delivery status.


> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Preserve the active issue owner and all existing worktrees.

**Goal:** Complete #5980's independently authorized geometry, persistence, title-bar theme, Quick Chat placement and tray-legibility behavior, then retain explicit Windows hardware and product-decision gates.

**Architecture:** Keep native window ownership in Tauri. Put deterministic bounds/monitor selection in a small Rust policy module, with Windows-only adapters for actual window observations and config persistence. Reuse the existing startup, main-window registry, theme and tray owners; do not introduce a window-state dependency or generic lifecycle framework.

**Tech stack:** Rust/Tauri2, existing serde/config facilities, React/TypeScript for app-mode observation, native and existing repository test runners.

**Spec:** https://github.com/OpenCoven/coven-cave/issues/5980 (all original acceptance remains binding).

## Global constraints

- Default desired client size1320×820 and existing desired minimum960×600; actual bounds must yield to the monitor work area, including native frame extents.
- Required Windows acceptance:1366×768 and1920×1080 at150% scaling, visible composer, matching title-bar theme, Quick Chat near the correct tray, legible light/dark taskbar icon.
- Native/custom chrome and optional global hotkey await Val's decisions. Do not infer approval from elapsed time. Implement independent behavior first.
- Preserve macOS overlay/notch and Linux behavior; no new dependencies, credential access, profile resets, signing or releases.
- Keep startup diagnostics, single-instance ownership, sidecar supervision and native close behavior intact.
- Physical/native observations are distinct from deterministic policy tests and Windows compilation.

## Review focus

1. Negative monitor origins, mixed DPI and removed monitors must not restore a window offscreen.
2. Tiny work areas and frame extents must not let minimum size force the composer outside the work area.
3. Maximized/minimized/fullscreen transitions must not overwrite the normal restore rectangle.
4. Invalid/truncated/read-only config must not prevent startup or destroy the last valid persisted state.
5. App-mode changes and OS taskbar theme changes are different sources; tray legibility must follow the taskbar, not assume it matches the app.

### Task 1: Main-window bounds and persistence

Files: new `src-tauri/src/window_placement.rs` (pure policy and tests); new `src-tauri/src/windows_window_state.rs` (Windows adapter/config tests); existing `src-tauri/src/lib.rs`, `src-tauri/src/tauri_setup.rs`, `src-tauri/release-runtime.test.mjs`.

Interface contract: policy uses physical integer rectangles and explicit frame extents. Conversion from logical default/minimum uses the selected monitor scale exactly once. Adapter observes actual outer/client size, selects a work area, applies client size and outer position before showing the Windows main window. Native events update normal placement only. State is versioned and scoped to the primary main window; detached/auxiliary windows cannot replace it.

- [x] Write failing policy cases for1366×768,1920×1080/1.5, negative-origin secondary monitor, monitor removal, tiny work area and native frame subtraction. Assert the entire outer rectangle is contained and centered only for fresh/fallback placement; valid saved placement stays where the user left it.
- [x] Run the new focused native tests and retain the expected failure, then implement saturating bounds/selection without platform handles.
- [x] Add config tests for valid round-trip, unsupported version, malformed/truncated data, missing file, denied write and preserving the last valid state after failed replacement. Use synthetic directories only.
- [x] Implement persistence with the repository's available atomic-file pattern after inspecting its Windows replacement behavior. Do not silently truncate the destination or write on every resize callback. Save normal geometry at a bounded lifecycle point and preserve it across maximize/minimize.
- [x] Integrate both Windows packaged startup and dev startup before first visible presentation. Keep non-Windows builders unchanged. Startup proceeds with safe default placement on unavailable config/monitor evidence and logs bounded diagnostics.
- [x] Add release-runtime source contracts proving both startup paths invoke the owner, and native tests proving invalid saved state cannot bypass bounds.
- [ ] Verify focused tests, full Rust suite/check, applicable runtime contracts and actual Windows build. Record hardware acceptance separately; no offscreen-free claim from arithmetic alone.

### Task 2: Native title-bar mode synchronization

Files: existing `src/components/tauri-titlebar-marker.tsx` or a narrowly scoped sibling if needed to preserve its macOS-only contract; existing root mount, Tauri capabilities and native setup; focused rendered behavior test registered in `scripts/run-tests.mjs`.

Interface contract: use the resolved root `data-mode` (light/dark) as the app-title-bar source. Native Windows synchronization accepts only those values; browser/macOS/Linux are not changed. Reuse the current-window API when already permitted; do not grant broad window authority merely for theming.

- [x] Inspect existing permissions and theme lifecycle before selecting the final bridge. Test initial resolved mode, light/dark change, cleanup during async initialization, and absence of non-Windows calls.
- [x] Implement the smallest allowed bridge, with no added visible controls or persistent duplicate theme store. Catch/report native failure without changing page theme.
- [ ] Run focused behavior and source-contract tests, typecheck, lint and relevant app/build gates. Verify real Windows native title-bar modes when hardware is available.

### Task 3: Quick Chat placement and tray contrast

Files: existing `src-tauri/src/window_geometry.rs`, tray callbacks in `tauri_setup.rs`, policy tests, existing icon-generation tooling only if required.

Interface contract: prefer the actual tray interaction rectangle/monitor where available; otherwise cursor monitor then primary. Clamp Quick Chat to that work area, accounting for taskbar edge and negative origin. Preserve existing macOS glass/notch placement. Read Windows taskbar/system appearance independently from app theme and use the existing icon silhouette/alpha for contrast variants.

- [x] Inspect Tauri tray-event geometry and theme event support in the pinned dependencies. Add failing cases for primary/secondary monitors, bottom/top/side taskbars, overflow-tray location, unavailable tray bounds and work area smaller than requested Quick Chat size.
- [x] Implement placement in the existing native owner and update position on reopening an existing window; do not create duplicate windows or alter child-origin/token handling.
- [x] Add icon tests preserving dimensions/alpha and proving light/dark foreground contrast selection; retain macOS template behavior.
- [ ] Verify native tests and Windows compilation, then collect specified taskbar/display observations or name the missing hardware gate.

### Task 4: Decisions, review and delivery

- [ ] If Val answers chrome/hotkey questions, reconcile only the affected scope; prepare a separate coherent increment for chosen chrome. A deferred hotkey is optional, not an acceptance failure.
- [x] Walk design-language section9 for changed surfaces. Keep copy, focus, reduced motion, tokens and native accessibility unchanged unless a tested correction is required.
- [ ] Run `node --test src-tauri/release-runtime.test.mjs`; from `src-tauri`, `cargo check --locked` and `cargo test --locked`. New Rust tests must run on applicable CI platforms; inspect current CI selector/Windows lane before publishing.
- [ ] For TS changes, use canonical focused runner arguments and `pnpm check:tests-wired`, `pnpm typecheck`, `pnpm lint`, relevant suites and `pnpm build` in the owned tree with isolated synthetic homes where required. No dependency symlinks.
- [ ] Obtain exact-diff review, retain failures, make DCO commits through existing hooks, publish scoped PR(s), and land only after all current-head selected checks plus Frontend build pass.
- [ ] Update #5980 with exact evidence, remaining product/hardware gates and retained worktree disposition. Do not close until original acceptance is actually supported. Rollback is a scoped code revert; new window-state config must remain ignorable by older builds.

## Continuity

Owned branch `fix/issue-5980-window-geometry`, worktree `.worktrees/issue-5980-window-geometry`, starting main `0a38e2ec43eac0289d1b436f1cd97dddad6238c8`. Reused the clean completed5917 unit; its original branch remains at46d8736f3a83a71f79158e64559b995cd5555aa0. Registered count28. Issue receipts6308248301/6308251783; old-unit disposition6308251549. No other worktree is disposable. Checkpoint outside repo: `~/.local/state/coven-cave-investigations/issue-5980/checkpoint.md`.

## Local verification checkpoint (2026-10-21)

Implementation and local review cover tasks1–3, including measured Quick Chat shadow
frame extents and direct Win32 presentation state for persistence. Review found
and repaired those two integration defects; focused recheck reports no remaining
Critical/Important findings. Native taskbar messages use a separate per-window
subclass; the authoritative close fallback remains untouched.

Local checks:304Rust tests,31release-runtime contracts,2126wired files, typecheck,
full lint, cargo check and production build/budgets pass. The first full app suite stopped at the plan checkbox disclaimer after1365passing files; the missing disclaimer was added and the targeted contract rerun. Full-suite rerun passed all1473app test files. Windows-only compilation/HWND test and physical
display/theme acceptance remain unverified. No PR or merge claimed.

Design section9: no new web controls, modal, motion, user-facing copy or CSS; the
bridge observes resolved mode and preserves existing focus/accessibility. Native
icon foreground colors intentionally follow OS taskbar contrast, not web theme
tokens. Actual native appearance/geometry remains in the Windows acceptance list
in docs/windows-window-placement.md.
