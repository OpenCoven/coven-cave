/**
 * Address-bar writes that Next's app router can still restore (#6442).
 *
 * Next marks each history entry it can restore with `__NA` plus its router
 * tree, and ignores a popstate to an entry that lacks them: the page stays on
 * whatever it was showing while the address changes. Next's AppRouter wraps
 * `history.pushState`/`replaceState` in a passive effect. Its wrapper copies
 * the current entry's markers into a state without `__NA` and syncs Next's
 * router URL; a state that already carries `__NA` is written as-is, with no
 * sync.
 *
 * React runs a child's passive effects before its parent's, so in the first
 * effect pass of a document a component's mount effect still sees the
 * browser's native methods. A raw `replaceState(null, …)` there erases the
 * markers Next has already written. Workspace stripping `?mode=` on load did
 * exactly that, and browser Back from Settings left Settings on screen.
 *
 * So these helpers keep the entry's own keys and choose the markers by who is
 * writing:
 * - Next's wrapper installed: pass the entry's own keys only. Next adds its
 *   markers and updates its router URL, which callers rely on.
 * - Native methods: carry the markers so the entry stays restorable, then sync
 *   Next's URL once its wrapper is in place (a microtask after this effect
 *   pass), as if the write had happened after mount.
 *
 * Use these instead of calling `history.replaceState`/`pushState` directly; a
 * source contract enforces it.
 */

type HistoryRecord = Record<string, unknown>;

/** Keys Next's app router stores on each entry it can restore. */
export const NEXT_HISTORY_ENTRY_KEYS = ["__NA", "__PRIVATE_NEXTJS_INTERNALS_TREE"] as const;

function asRecord(state: unknown): HistoryRecord {
  return state !== null && typeof state === "object" && !Array.isArray(state) ? { ...(state as HistoryRecord) } : {};
}

function nextMarkers(state: unknown): HistoryRecord {
  const source = asRecord(state);
  const markers: HistoryRecord = {};
  for (const key of NEXT_HISTORY_ENTRY_KEYS) {
    if (key in source) markers[key] = source[key];
  }
  return markers;
}

function withoutNextMarkers(state: unknown): HistoryRecord {
  const own = asRecord(state);
  for (const key of NEXT_HISTORY_ENTRY_KEYS) delete own[key];
  return own;
}

/** True while the browser's own History methods are installed, i.e. before Next wraps them. */
function usesNativeHistoryMethods(history: History): boolean {
  return (
    typeof History !== "undefined" &&
    history instanceof History &&
    history.replaceState === History.prototype.replaceState &&
    history.pushState === History.prototype.pushState
  );
}

function scheduleRouterUrlSync(url: string) {
  queueMicrotask(() => {
    if (typeof window === "undefined") return;
    const { history, location } = window;
    if (usesNativeHistoryMethods(history)) return;
    const written = new URL(url, location.href);
    if (written.href !== location.href) return; // a later write already moved on
    history.replaceState(withoutNextMarkers(history.state), "", url);
  });
}

/** Replace the current entry's URL, keeping its state restorable by Next. */
export function replaceHistoryUrl(url: string): void {
  if (typeof window === "undefined") return;
  const { history } = window;
  const own = withoutNextMarkers(history.state);
  if (!usesNativeHistoryMethods(history)) {
    history.replaceState(own, "", url);
    return;
  }
  history.replaceState({ ...own, ...nextMarkers(history.state) }, "", url);
  scheduleRouterUrlSync(url);
}

/**
 * Push a new entry for `url`. Like Next's own wrapper, the new entry inherits
 * only Next's markers, not the previous entry's own keys.
 */
export function pushHistoryUrl(url: string): void {
  if (typeof window === "undefined") return;
  const { history } = window;
  if (!usesNativeHistoryMethods(history)) {
    history.pushState({}, "", url);
    return;
  }
  history.pushState(nextMarkers(history.state), "", url);
  scheduleRouterUrlSync(url);
}
