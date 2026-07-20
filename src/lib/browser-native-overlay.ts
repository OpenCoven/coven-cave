export const NATIVE_WEBVIEW_COVER_SELECTOR =
  '[role="dialog"], [aria-modal="true"], [role="menu"], [role="listbox"], [data-native-webview-cover="true"]';
export const BROWSER_RECONCILE_INTERVAL_MS = 100;
export const BROWSER_MOTION_WINDOW_MS = 400;
export const WEBVIEW_OFFSCREEN = -10000;

const BROWSER_RECONCILE_METRICS_KEY = "__CAVE_BROWSER_RECONCILE_METRICS__";

type BrowserReconcileMetrics = {
  count: number;
  totalDurationMs: number;
  lastDurationMs: number;
  startedAt: number;
};

/** Native webviews paint above DOM: yield whenever a dialog or real overlay covers the target. */
export function surfaceIsCovered(surface: HTMLElement, rect: DOMRect, documentRef: Document = document): boolean {
  const overlays = documentRef.querySelectorAll(NATIVE_WEBVIEW_COVER_SELECTOR);
  for (const overlay of overlays) {
    if (overlay.getClientRects().length > 0) return true;
  }
  const inset = 12;
  const points: Array<[number, number]> = [
    [rect.left + rect.width / 2, rect.top + rect.height / 2],
    [rect.left + inset, rect.top + inset],
    [rect.right - inset, rect.top + inset],
    [rect.left + inset, rect.bottom - inset],
    [rect.right - inset, rect.bottom - inset],
  ];
  for (const [x, y] of points) {
    const hit = documentRef.elementFromPoint(x, y);
    if (!hit || surface.contains(hit)) continue;
    if (hit.closest('[role="status"], [role="alert"], [aria-live]')) continue;
    return true;
  }
  return false;
}

/** Keep lightweight reconciliation telemetry on the host window for diagnostics. */
export function recordBrowserReconcile(durationMs: number, target: Window = window): void {
  const metricsWindow = target as Window & { [BROWSER_RECONCILE_METRICS_KEY]?: BrowserReconcileMetrics };
  const metrics = metricsWindow[BROWSER_RECONCILE_METRICS_KEY] ?? {
    count: 0,
    totalDurationMs: 0,
    lastDurationMs: 0,
    startedAt: Date.now(),
  };
  metrics.count += 1;
  metrics.totalDurationMs += durationMs;
  metrics.lastDurationMs = durationMs;
  metricsWindow[BROWSER_RECONCILE_METRICS_KEY] = metrics;
}

export function nodeContainsNativeWebviewCover(node: Node): boolean {
  return node instanceof Element && (
    node.matches(NATIVE_WEBVIEW_COVER_SELECTOR) ||
    node.querySelector(NATIVE_WEBVIEW_COVER_SELECTOR) !== null
  );
}
