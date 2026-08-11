export type PanelShortcutBinding = {
  key: string;
  primary: boolean;
  shift: boolean;
  alt: boolean;
};

export type PanelShortcutBindings = {
  toggleLeftPanel: PanelShortcutBinding;
  toggleRightPanel: PanelShortcutBinding;
};

export const PERSISTED_PANEL_SHORTCUTS_KEY = "cave:keyboard-shortcuts:panels";

export const DEFAULT_PANEL_SHORTCUTS: PanelShortcutBindings = {
  toggleLeftPanel: { key: "b", primary: true, shift: false, alt: false },
  toggleRightPanel: { key: "b", primary: true, shift: true, alt: false },
};

function normalizeShortcutBinding(value: unknown): PanelShortcutBinding | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<PanelShortcutBinding>;
  if (typeof candidate.key !== "string" || candidate.key.trim().length === 0) return null;
  return {
    key: candidate.key.trim().toLowerCase(),
    primary: candidate.primary !== false,
    shift: candidate.shift === true,
    alt: candidate.alt === true,
  };
}

function readPersistedPanelShortcutOverrides(): Partial<PanelShortcutBindings> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(PERSISTED_PANEL_SHORTCUTS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<Record<keyof PanelShortcutBindings, unknown>>;
    return {
      ...(normalizeShortcutBinding(parsed.toggleLeftPanel)
        ? { toggleLeftPanel: normalizeShortcutBinding(parsed.toggleLeftPanel)! }
        : {}),
      ...(normalizeShortcutBinding(parsed.toggleRightPanel)
        ? { toggleRightPanel: normalizeShortcutBinding(parsed.toggleRightPanel)! }
        : {}),
    };
  } catch {
    return {};
  }
}

export function getPanelShortcutBindings(
  overrides: Partial<PanelShortcutBindings> = {},
): PanelShortcutBindings {
  return {
    ...DEFAULT_PANEL_SHORTCUTS,
    ...readPersistedPanelShortcutOverrides(),
    ...overrides,
  };
}

/**
 * The pressed key, lowercased — or null when the event does not carry one.
 *
 * `KeyboardEvent.key` is typed as a string but is absent in practice whenever
 * the event is not really a keyboard event: a synthetic `new Event("keydown")`
 * from a password manager or browser extension, and some IME/composition
 * paths. The desktop shell runs inside WKWebView, which makes an off-spec
 * event more likely rather than less.
 *
 * It matters more than one dropped keystroke: the throw escaped the shell's
 * keydown handler, so a single malformed event disabled EVERY panel shortcut
 * until reload (cave-lryhx).
 */
export function eventKey(event: KeyboardEvent): string | null {
  return typeof event.key === "string" ? event.key.toLowerCase() : null;
}

export function matchesPanelShortcut(
  event: KeyboardEvent,
  shortcut: PanelShortcutBinding,
): boolean {
  const key = eventKey(event);
  // An event we cannot read a key from matches no shortcut. Returning false
  // rather than throwing lets the handler ignore it and carry on.
  if (key === null) return false;
  const primary = event.metaKey || event.ctrlKey;
  if (key !== shortcut.key.toLowerCase()) return false;
  if (primary !== shortcut.primary) return false;
  if (event.shiftKey !== shortcut.shift) return false;
  if (event.altKey !== shortcut.alt) return false;
  return true;
}

export function labelPanelShortcut(shortcut: PanelShortcutBinding): string {
  const key = shortcut.key.length === 1 ? shortcut.key.toUpperCase() : shortcut.key;
  return `${shortcut.primary ? "⌘" : ""}${shortcut.alt ? "⌥" : ""}${shortcut.shift ? "⇧" : ""}${key}`;
}
