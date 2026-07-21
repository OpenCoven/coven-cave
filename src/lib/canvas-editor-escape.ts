// Escape-key precedence for the canvas sketch editor: while the sketch is in
// native fullscreen the browser owns Escape (it exits fullscreen itself, and
// one press must peel exactly one layer); then fields own Escape while they
// hold content, then a component selection clears, then in-app expand exits.
// One deterministic resolver so the editor and its tests share the rule (the
// component module imports CSS, so tests import this instead).

export type CanvasEscapeAction = "none" | "clear-selection" | "exit-expand";

export function resolveEscapeAction(state: {
  nativeFullscreen: boolean;
  fieldHasContent: boolean;
  hasSelection: boolean;
  expanded: boolean;
}): CanvasEscapeAction {
  if (state.nativeFullscreen) return "none";
  if (state.fieldHasContent) return "none";
  if (state.hasSelection) return "clear-selection";
  if (state.expanded) return "exit-expand";
  return "none";
}
