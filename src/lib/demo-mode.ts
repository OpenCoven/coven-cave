export const DEMO_MODE_STORAGE_KEY = "cave:demo-mode";
export const DEMO_MODE_EVENT = "cave:demo-mode-change";
export const DEMO_MODE_HEADER = "x-cave-demo-mode";

export const DEMO_MODE_ENV =
  typeof process !== "undefined" &&
  process.env.NEXT_PUBLIC_DEMO === "true";

function hasWindow(): boolean {
  return typeof window !== "undefined";
}

function launchUrlRequestsDemoMode(): boolean {
  if (!hasWindow()) return false;
  try {
    const value = new URL(window.location.href).searchParams.get("demo");
    return value === "1" || value === "true";
  } catch {
    return false;
  }
}

export function isDemoModeEnabled(): boolean {
  if (DEMO_MODE_ENV) return true;
  if (!hasWindow()) return false;
  try {
    const stored = window.localStorage.getItem(DEMO_MODE_STORAGE_KEY);
    return stored === "1" || stored === "true" || launchUrlRequestsDemoMode();
  } catch {
    return launchUrlRequestsDemoMode();
  }
}

function dispatchDemoModeChange() {
  if (!hasWindow()) return;
  try {
    window.dispatchEvent(new Event(DEMO_MODE_EVENT));
  } catch {
    /* ignore */
  }
}

export function setDemoModeEnabled(enabled: boolean): void {
  if (!hasWindow()) return;
  try {
    if (enabled) window.localStorage.setItem(DEMO_MODE_STORAGE_KEY, "1");
    else window.localStorage.removeItem(DEMO_MODE_STORAGE_KEY);
  } catch {
    /* ignore */
  }
  dispatchDemoModeChange();
}

export function clearDemoModeData(): void {
  if (!hasWindow()) return;
  try {
    window.localStorage.removeItem(DEMO_MODE_STORAGE_KEY);
  } catch {
    /* ignore */
  }
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.has("demo")) {
      url.searchParams.delete("demo");
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    }
  } catch {
    /* ignore */
  }
  dispatchDemoModeChange();
}

export function persistDemoModeLaunchFlag(): boolean {
  if (!launchUrlRequestsDemoMode()) return false;
  setDemoModeEnabled(true);
  return true;
}

export function demoModeFetchHeaders(enabled = isDemoModeEnabled()): HeadersInit | undefined {
  return enabled ? { [DEMO_MODE_HEADER]: "1" } : undefined;
}

export function isDemoModeRequest(req: Request): boolean {
  if (DEMO_MODE_ENV) return true;
  const header = req.headers.get(DEMO_MODE_HEADER);
  if (header === "1" || header === "true") return true;
  try {
    const value = new URL(req.url).searchParams.get("demo");
    return value === "1" || value === "true";
  } catch {
    return false;
  }
}
