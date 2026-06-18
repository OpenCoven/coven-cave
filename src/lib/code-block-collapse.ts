// Collapse/expand toggle for chat code blocks. Pure (operates on the minimal
// DOM surface it needs) so the behavior is unit-testable without a browser —
// the click listener that calls this is attached in message-bubble's
// wireCopyButtons, the same path that wires the (shipped) Copy button.

type ClassListLike = { toggle(token: string): boolean };
type WrapLike = { classList: ClassListLike };
type BtnLike = { setAttribute(name: string, value: string): void };

export const CODE_COLLAPSED_CLASS = "cave-code-wrap--collapsed";

/**
 * Toggle a code block's collapsed state and keep the toggle button's a11y
 * attributes in sync. Returns the new collapsed state.
 */
export function toggleCodeBlockCollapse(wrap: WrapLike, btn: BtnLike): boolean {
  const collapsed = wrap.classList.toggle(CODE_COLLAPSED_CLASS);
  btn.setAttribute("aria-expanded", String(!collapsed));
  btn.setAttribute("aria-label", collapsed ? "Expand code" : "Collapse code");
  return collapsed;
}
