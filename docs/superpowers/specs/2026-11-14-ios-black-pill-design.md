# Native iOS black and pill chat treatment

The approved design authority is OpenCoven/coven-cave #6331: all seven original targets remain in scope for `apps/ios/CovenCave`, bundle `ai.opencoven.cave`. This document maps those targets to the current native implementation; it does not replace the missing private image comparison. Val approved this issue's isolated worktree on 14 November. The original images remain unavailable, and exact reference fidelity cannot yet be accepted.

Use the existing SwiftUI chat views and shared primitives. Keep `ChromePalette` authoritative for dark, light, published palettes and accessibility appearances. Give chat chrome neutral solid surfaces, restrained hairlines and circular controls; remove ambient accent washes and ornamental glow from the changed chat surfaces. Do not change appearance preferences, Settings' visual system, or permission and session ownership.

The existing navigation stack and toolbar remain responsible for Back and drawer actions, including Duo's trailing status/control column. A compact conversation pill opens the existing session controls and retains exact conversation and familiar attribution. Keep real call actions conditional on existing support. Do not add unsupported overflow destinations or a Work mode.

Keep the drawer's live rounded, offset destination and focus behavior. Give the active drawer an opaque readable floor, selected and pinned/recent conversation treatment, actual chat search, New chat and Settings. The destination scrim must not dim the active panel.

Transcript surfaces become neutral and softly rounded with comfortable reading insets. Preserve native row IDs, all rich renderer lifetime/height contracts, selectable native text, reader controls, role/familiar attribution, streaming, errors, queued state, attachments, actions and follow-latest intent. Do not restructure the transcript owner to obtain the new appearance.

The composer is one floating rounded surface: multiline draft region above a compact action row containing attach, supported model/session control, real dictation and send/stop-dictation actions. Preserve the existing TextField binding, hardware-key handling, native keyboard avoidance, pending image state, draft persistence, exact targets and fail-closed send conditions. Do not hardcode keyboard height or add a fake runtime stop capability.

Empty chat uses open space and a small set of simple icon-and-text suggestions near the composer. Keep permission access available and keep tapping a suggestion as fill-and-focus, never auto-send. Existing meaningful choices may use a capsule selection treatment; no decorative Chat/Work selector is added.

Implementation calls left to this unit are point-based spacing and radii derived from the native baseline, using shared `ChatChrome` constants. These are builder choices, not measurements from unavailable original images. Prefer modifying the existing chat primitives over a new navigation shell or an app-wide glass replacement.

Completion requires real candidate before/after captures, original regression and accessibility/appearance matrices, protected review/merge under applicable authority, clean-main signing/archive/upload/processing/tester receipts and physical Duo acceptance through the original owners. Simulator or source evidence does not substitute for those gates. Keep every unsupported/skipped row and first failure visible.
