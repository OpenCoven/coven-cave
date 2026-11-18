# Desktop title-bar reference

Val approved adapting the supplied desktop screenshot to Coven Cave, including one additional issue-owned worktree. Canonical outcome: #6496. The original iOS #6331 outcome remains separate.

Use a continuous charcoal window band above a rounded, subtly outlined workspace. Give existing project/familiar selectors a softly raised tab-like treatment, with quiet monochrome window navigation and compact search/status controls. Resolve every color through the current palette so appearance choices remain effective.

Adapt the existing Shell and controls with a component-imported, macOS desktop-scoped stylesheet. This preserves navigation, Chat-local filter semantics, accessibility labels, permissions and Tauri's deep drag regions. Adding a second tab/navigation model or copying the reference's review/merge controls would introduce unsupported behavior; neither is part of the styling request.

The inset workspace must spend its margin out of the available height, with one shared title-bar height, no extra panel header padding, and enough room for long labels at narrow desktop widths. Native traffic-light visibility/fullscreen behavior stays under the existing owner.

Acceptance combines existing chrome/context/token checks with rendered dark/light/non-default-theme, narrow/wide, expanded/collapsed and focus inspection. Native dragging and traffic-light behavior require an actual Tauri window; browser-applied native markers prove styling only.

Val extended the request with a second screenshot of the left rail. Present the existing open navigation as a 48px monochrome icon strip next to the contextual list, with rounded neutral selection, group dividers and utilities at the bottom. Keep the actual labels in accessible names, preserve live count badges and arrow-key navigation, and keep closing the Panel at zero width. Native title controls must reserve at least the traffic-light inset even though the open rail is narrower. This reuses the existing navigation owner; it does not add a persistent collapsed rail, plugin destinations, duplicate routes or a second active-selection model.

The fixed native icon rail preserves its pixel width while the window resizes; entering and leaving a wide fullscreen window must retain its open/closed state. The main detail panel absorbs the change.
