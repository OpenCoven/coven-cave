# Desktop title-bar reference implementation plan

> Execute inline in the approved #6496 worktree, preserving the canonical issue as the work record.

**Goal:** Adapt the desktop top area to Val's supplied screenshot while retaining Cave's existing controls.

**Architecture:** Shell imports one scoped stylesheet. Existing state, handlers, Tauri drag regions and shared controls remain authoritative. The native open Panel is fixed at 48px through its size constraints, with a separate saved-layout key; CSS does not clip a wider allocation.

**Tech stack:** Next.js 16.4.3, React, semantic CSS tokens, Tauri.

**Spec:** `docs/superpowers/specs/2026-11-14-desktop-titlebar-reference-design.md`.

## Constraints and review focus

Preserve the 1024px desktop boundary, all appearance choices, Chat-local filter semantics, native traffic-light/fullscreen ownership and interactive drag exclusions. Inspect long labels, narrow windows, popover stacking, keyboard focus, and reduced motion/transparency. No new dependencies or navigation model are needed.

## Task 1: Restyle and qualify existing desktop chrome

- [x] Restore dependencies in the isolated worktree and run the six existing chrome/context/token baseline suites.
- [x] Import `src/styles/desktop-titlebar.css` from `src/components/shell.tsx`; scope the surface, insets and control treatment to macOS desktop chrome.
- [x] Extend the same scoped stylesheet for the requested 48px open icon rail. Verify actual rendered width, accessible names, arrow navigation, current selection and close/reopen behavior in `tests/desktop-reference-chrome.spec.ts`; retain its first 188px-versus-48px failure.
- [x] Run the existing focused suites, token checks, typecheck/lint and production build. This reversible styling change needs rendered verification rather than a new test that mirrors CSS declarations.
- [x] Inspect actual rendered wide/narrow, theme, collapse, popover and focus states; retain captures and command receipts.
- [x] Launch an owned native development window on a unique origin and verify native dragging/control/traffic-light behavior without replacing the installed app.
- [x] Record exact evidence and outstanding acceptance on #6496. Preserve the worktree for review; commit/push/merge/release need their applicable authority.

## Execution evidence

The first rendered test failed with an actual 188px rail instead of 48px. The panel library supplies an inline maximum and owns the outer allocation, so a CSS width cap is insufficient. Apply the native-only width through Panel constraints, use that width in destination restoration and Chat fit decisions, and retain zero-width collapse. Browser label widths and saved layouts remain separate.

Final qualification: `build-fullscreen-fixed.log` passed typechecking, production compilation and both bundle budgets. `fullscreen-focused.log` passed 12/12; the raw token scanner passed separately; full lint and the final changed-file lint passed. `rendered-fullscreen-fixed.log` passed 3/3 in real WebKit against the production artifact, covering native/browser layout separation, accessible navigation, zero-width close/reopen, dark/light/tide, popup focus return, long labels/reload, 1023/1024 transitions, and the 3840-to-1320 resize regression. The isolated native Tauri test bundle visibly preserved the rail and restored native traffic lights across an actual fullscreen round trip. Native drag input was exercised without activating controls; the driver crops screenshots to the window and does not report global window displacement. Data was synthetic and this is local qualification, not an installed-app update or release.

## Owner acceptance and publication

Val accepted the retained dark/light/Tide visuals, then confirmed native window dragging and asked to proceed with publication on 17 November. Global displacement is owner-confirmed; it is not inferred from the cropped-window driver. The [canonical issue](https://github.com/OpenCoven/coven-cave/issues/6496) retains the native reduced-transparency observations, first failures, retries and unsupported rows.

The candidate was preserved before fast-forwarding its branch onto main at `510c8f4378bb5d1ec70f334fe0e6729002755d67`. Production shell and stylesheet hashes remained identical to the accepted candidate. Final production WebKit coverage passed after selecting the long-label project through the picker's accessible filter, avoiding its intentional Recent/All projects duplicate. The existing navigation-coupling source pin now names the effective native/browser width; its policy and state-machine assertions remain intact.
