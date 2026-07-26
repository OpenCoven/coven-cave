export const HOME_URL = "https://opencoven.ai";

const PINNED_STORAGE_KEY = "cave.browser.pinnedTabs.v1";
const RAIL_PINNED_STORAGE_KEY = "cave.browser.railPinned.v1";

export type BrowserTab = { id: string; url: string; title: string; pinned: boolean; kind: "pinned" };

/**
 * Restored registry state is only valid when its tab still exists in the
 * pinned-tab model. A removed tab must not apply its old address to whichever
 * tab happens to be first.
 */
export function resolveRestoredBrowserNavigation(
  tabs: BrowserTab[],
  storedActiveTabId: string,
  storedAddress: string,
): { activeTabId: string; address: string; restoredTabExists: boolean } {
  const restoredTab = tabs.find((tab) => tab.id === storedActiveTabId);
  if (restoredTab) {
    return {
      activeTabId: restoredTab.id,
      address: storedAddress || restoredTab.url,
      restoredTabExists: true,
    };
  }
  const fallback = tabs[0];
  return {
    activeTabId: fallback?.id ?? "home",
    address: fallback?.url ?? HOME_URL,
    restoredTabExists: false,
  };
}

export function normalizeBrowserUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return HOME_URL;
  let candidate = trimmed;
  if (/^localhost(:\d+)?(\/.*)?$/i.test(trimmed)) candidate = `http://${trimmed}`;
  else if (/^[a-z0-9-]+\.[a-z]{2,}/i.test(trimmed) && !/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) candidate = `https://${trimmed}`;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") return parsed.toString();
  } catch { /* fall through to search */ }
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
}

export function browserTabTitle(url: string, title: string): string {
  if (title && title !== url) return title.slice(0, 22);
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "localhost") return `localhost:${parsed.port || "80"}`;
    return parsed.hostname.replace(/^www\./, "").slice(0, 18);
  } catch { return url.slice(0, 18); }
}

export function defaultPinnedTabs(): BrowserTab[] {
  return [
    { id: "home", url: HOME_URL, title: "OpenCoven", pinned: true, kind: "pinned" },
    { id: "opencoven-docs", url: "https://docs.opencoven.ai", title: "Docs", pinned: true, kind: "pinned" },
    { id: "opencoven-feedback", url: "https://feedback.opencoven.ai", title: "Feedback", pinned: true, kind: "pinned" },
    { id: "github", url: "https://github.com/OpenCoven", title: "GitHub", pinned: true, kind: "pinned" },
  ];
}

export function loadPinnedTabs(): BrowserTab[] {
  if (typeof window === "undefined") return defaultPinnedTabs();
  try {
    const raw = window.localStorage.getItem(PINNED_STORAGE_KEY);
    if (raw) return (JSON.parse(raw) as BrowserTab[]).filter((tab) => tab.kind === "pinned");
  } catch { /* ignore malformed persisted state */ }
  return defaultPinnedTabs();
}

export function savePinnedTabs(tabs: BrowserTab[]) {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(PINNED_STORAGE_KEY, JSON.stringify(tabs)); } catch { /* best effort */ }
}

export function loadRailPinned(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const raw = window.localStorage.getItem(RAIL_PINNED_STORAGE_KEY);
    if (raw === "0") return false;
    if (raw === "1") return true;
  } catch { /* best effort */ }
  return true;
}

export function saveRailPinned(pinned: boolean) {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(RAIL_PINNED_STORAGE_KEY, pinned ? "1" : "0"); } catch { /* best effort */ }
}
