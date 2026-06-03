"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Icon } from "@/lib/icon";
import { BrowserQuickOpen } from "@/components/browser-quick-open";

// Browser pane — uses Tauri's child WebviewBuilder under the hood. A real
// Chromium webview is overlaid on top of the placeholder <div> below; we
// track the div's viewport-relative bounds with a ResizeObserver and call
// `browser_set_bounds` so the overlay stays aligned during resize, scroll,
// or layout changes.
//
// In `next dev` outside Tauri there's no webview — we render a fallback iframe.
//
// Tab design:
// - Pinned tabs persisted in localStorage (user-customizable)
// - Dynamic localhost tab auto-injected when a project dev server is detected
// - Each tab uses a separate native webview label: `<paneLabel>-tab-<id>`

type TauriBridge = {
  invoke: <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
  listen: <T = unknown>(event: string, cb: (e: { payload: T }) => void) => Promise<() => void>;
};

async function loadTauri(): Promise<TauriBridge | null> {
  if (typeof window === "undefined") return null;
  // @ts-expect-error Tauri runtime
  if (!window.__TAURI_INTERNALS__) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  const { listen } = await import("@tauri-apps/api/event");
  return { invoke, listen };
}

const HOME_URL = "https://opencoven.ai";
const LOCALHOST_PORTS = [3000, 3001, 5173, 8080, 4000, 4321];
const PINNED_STORAGE_KEY = "cave.browser.pinnedTabs.v1";

export type BrowserTab = {
  id: string;
  url: string;
  title: string;
  pinned: boolean;
  /** "localhost" tabs are dynamic — auto-added/removed based on dev server detection */
  kind: "pinned" | "localhost";
};

function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return HOME_URL;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^localhost(:\d+)?(\/.*)?$/.test(trimmed)) return `http://${trimmed}`;
  if (/^[a-z0-9-]+\.[a-z]{2,}/i.test(trimmed)) return `https://${trimmed}`;
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
}

function shortTitle(url: string, title: string): string {
  if (title && title !== url) return title.slice(0, 22);
  try {
    const u = new URL(url);
    if (u.hostname === "localhost") return `localhost:${u.port || "80"}`;
    return u.hostname.replace(/^www\./, "").slice(0, 18);
  } catch {
    return url.slice(0, 18);
  }
}

function loadPinnedTabs(): BrowserTab[] {
  if (typeof window === "undefined") return defaultPinnedTabs();
  try {
    const raw = window.localStorage.getItem(PINNED_STORAGE_KEY);
    if (raw) return JSON.parse(raw) as BrowserTab[];
  } catch { /* ignore */ }
  return defaultPinnedTabs();
}

function savePinnedTabs(tabs: BrowserTab[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PINNED_STORAGE_KEY, JSON.stringify(tabs));
  } catch { /* ignore */ }
}

function defaultPinnedTabs(): BrowserTab[] {
  return [
    { id: "home", url: HOME_URL, title: "OpenCoven", pinned: true, kind: "pinned" },
    { id: "vercel", url: "https://vercel.com/dashboard", title: "Vercel", pinned: true, kind: "pinned" },
    { id: "github", url: "https://github.com/OpenCoven", title: "GitHub", pinned: true, kind: "pinned" },
  ];
}

async function probeLocalhost(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://localhost:${port}`, {
      method: "HEAD",
      signal: AbortSignal.timeout(800),
      mode: "no-cors",
    });
    // no-cors always returns opaque — if it didn't throw, something is there
    void res;
    return true;
  } catch {
    return false;
  }
}

export function BrowserPane({ label = "default" }: { label?: string }) {
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const paneRef = useRef<HTMLDivElement | null>(null);
  const [bridge, setBridge] = useState<TauriBridge | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  // Tab state
  const [tabs, setTabs] = useState<BrowserTab[]>(() => loadPinnedTabs());
  const [activeTabId, setActiveTabId] = useState<string>(() => loadPinnedTabs()[0]?.id ?? "home");
  const [tabTitles, setTabTitles] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [addressBar, setAddressBar] = useState<string>(HOME_URL);
  const [quickOpen, setQuickOpen] = useState(false);

  // History per-tab
  const historyRef = useRef<Record<string, { stack: string[]; idx: number }>>({});

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0];
  const activeUrl = activeTab?.url ?? HOME_URL;

  function tabLabel(tabId: string) {
    return `${label}-tab-${tabId}`;
  }

  // ── Tauri bridge ──────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const b = await loadTauri();
      if (cancelled) return;
      if (!b) setUnavailable(true);
      else setBridge(b);
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Page-load + title events ──────────────────────────────────────
  useEffect(() => {
    if (!bridge) return;
    let unlistenLoad: (() => void) | null = null;
    let unlistenTitle: (() => void) | null = null;

    void bridge.listen<{ label: string; url: string; phase: string }>(
      "browser:page-load",
      (e) => {
        const { label: evLabel, url: evUrl, phase } = e.payload;
        // Match any of our tab labels
        if (!evLabel.startsWith(`${label}-tab-`)) return;
        const tabId = evLabel.slice(`${label}-tab-`.length);
        if (phase === "started") {
          if (tabId === activeTabId) setLoading(true);
        } else {
          if (tabId === activeTabId) {
            setLoading(false);
            setAddressBar(evUrl);
          }
          // Update tab URL
          setTabs((prev) =>
            prev.map((t) =>
              t.id === tabId ? { ...t, url: evUrl } : t
            )
          );
          // Push to per-tab history
          const h = historyRef.current[tabId] ?? { stack: [evUrl], idx: 0 };
          const next = [...h.stack.slice(0, h.idx + 1), evUrl];
          historyRef.current[tabId] = { stack: next, idx: next.length - 1 };
        }
      },
    ).then((fn) => { unlistenLoad = fn; });

    void bridge.listen<{ label: string; title: string; url: string }>(
      "browser:title",
      (e) => {
        const { label: evLabel, title, url: evUrl } = e.payload;
        if (!evLabel.startsWith(`${label}-tab-`)) return;
        const tabId = evLabel.slice(`${label}-tab-`.length);
        setTabTitles((prev) => ({ ...prev, [tabId]: title }));
        if (tabId === activeTabId) setAddressBar(evUrl);
      },
    ).then((fn) => { unlistenTitle = fn; });

    return () => { unlistenLoad?.(); unlistenTitle?.(); };
  }, [bridge, label, activeTabId]);

  // ── Sync active tab webview bounds ────────────────────────────────
  useEffect(() => {
    if (!bridge) return;
    const surface = surfaceRef.current;
    if (!surface) return;

    let raf = 0;
    const sync = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const rect = surface.getBoundingClientRect();
        if (rect.width <= 1 || rect.height <= 1) {
          // Hide all tab webviews when panel collapses
          tabs.forEach((t) => {
            void bridge.invoke("browser_hide", { label: tabLabel(t.id) });
          });
          return;
        }
        // Show active tab, hide others
        tabs.forEach((t) => {
          if (t.id === activeTabId) {
            void bridge.invoke("browser_set_bounds", {
              label: tabLabel(t.id),
              x: rect.left, y: rect.top,
              w: rect.width, h: rect.height,
            });
          } else {
            void bridge.invoke("browser_hide", { label: tabLabel(t.id) });
          }
        });
      });
    };

    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(surface);
    window.addEventListener("resize", sync);
    window.addEventListener("scroll", sync, true);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("resize", sync);
      window.removeEventListener("scroll", sync, true);
      // Hide all on unmount
      tabs.forEach((t) => {
        void bridge.invoke("browser_hide", { label: tabLabel(t.id) });
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge, label, activeTabId, tabs.map((t) => t.id).join(",")]);

  // ── Navigate active tab when URL changes ─────────────────────────
  useEffect(() => {
    if (!bridge || !activeTab) return;
    // Small delay to let panel layout fully settle before reading bounds
    const timer = setTimeout(() => {
      const surface = surfaceRef.current;
      if (!surface) return;
      const rect = surface.getBoundingClientRect();
      if (rect.width <= 1 || rect.height <= 1) return;
      setLoading(true);
      void bridge.invoke("browser_navigate", {
        label: tabLabel(activeTab.id),
        url: activeTab.url,
        x: rect.left, y: rect.top,
        w: rect.width, h: rect.height,
      });
      setAddressBar(activeTab.url);
    }, 80);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge, activeTab?.url, activeTab?.id]);

  // ── Localhost probe ───────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const probe = async () => {
      for (const port of LOCALHOST_PORTS) {
        if (cancelled) break;
        const live = await probeLocalhost(port);
        if (live && !cancelled) {
          const locUrl = `http://localhost:${port}`;
          setTabs((prev) => {
            const existing = prev.find((t) => t.kind === "localhost");
            if (existing?.url === locUrl) return prev;
            const filtered = prev.filter((t) => t.kind !== "localhost");
            return [
              ...filtered,
              {
                id: `localhost-${port}`,
                url: locUrl,
                title: `localhost:${port}`,
                pinned: false,
                kind: "localhost",
              },
            ];
          });
          return;
        }
      }
      if (!cancelled) {
        // No localhost found — remove stale localhost tab
        setTabs((prev) => prev.filter((t) => t.kind !== "localhost"));
      }
    };
    void probe();
    const interval = setInterval(() => void probe(), 8000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  // ── Tab actions ───────────────────────────────────────────────────
  const switchTab = useCallback((id: string) => {
    setActiveTabId(id);
    const tab = tabs.find((t) => t.id === id);
    if (tab) {
      setAddressBar(tab.url);
      historyRef.current[id] ??= { stack: [tab.url], idx: 0 };
    }
    setLoading(false);
  }, [tabs]);

  const pinCurrentPage = () => {
    const newId = `pin-${Date.now()}`;
    const newTab: BrowserTab = {
      id: newId,
      url: activeUrl,
      title: tabTitles[activeTabId] ?? "",
      pinned: true,
      kind: "pinned",
    };
    const next = [...tabs.filter((t) => t.kind === "pinned"), newTab, ...tabs.filter((t) => t.kind === "localhost")];
    setTabs(next);
    savePinnedTabs(next.filter((t) => t.kind === "pinned"));
  };

  const removeTab = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const tab = tabs.find((t) => t.id === id);
    if (!tab || tab.kind === "localhost") return; // localhost tabs aren't manually closeable
    if (bridge) void bridge.invoke("browser_close", { label: tabLabel(id) });
    const next = tabs.filter((t) => t.id !== id);
    setTabs(next);
    savePinnedTabs(next.filter((t) => t.kind === "pinned"));
    if (activeTabId === id) setActiveTabId(next[0]?.id ?? "home");
  };

  // ── Per-tab navigation ────────────────────────────────────────────
  const navigateTo = (raw: string) => {
    const next = normalizeUrl(raw);
    const nextTabs = tabs.map((t) =>
      t.id === activeTabId ? { ...t, url: next } : t,
    );
    setTabs(nextTabs);
    setAddressBar(next);

    if (!bridge) {
      const h = historyRef.current[activeTabId] ?? { stack: [activeUrl], idx: 0 };
      if (h.stack[h.idx] !== next) {
        const stack = [...h.stack.slice(0, h.idx + 1), next];
        historyRef.current[activeTabId] = { stack, idx: stack.length - 1 };
      }
    }

    const updatedActiveTab = nextTabs.find((t) => t.id === activeTabId);
    if (updatedActiveTab?.kind === "pinned") {
      savePinnedTabs(nextTabs.filter((t) => t.kind === "pinned"));
    }
  };

  const h = historyRef.current[activeTabId] ?? { stack: [activeUrl], idx: 0 };
  const canBack = h.idx > 0;
  const canForward = h.idx < h.stack.length - 1;

  const goBack = () => {
    const hh = historyRef.current[activeTabId];
    if (!hh || hh.idx <= 0) return;
    hh.idx -= 1;
    const prev = hh.stack[hh.idx];
    setTabs((t) => t.map((tab) => tab.id === activeTabId ? { ...tab, url: prev } : tab));
    setAddressBar(prev);
  };

  const goForward = () => {
    const hh = historyRef.current[activeTabId];
    if (!hh || hh.idx >= hh.stack.length - 1) return;
    hh.idx += 1;
    const next = hh.stack[hh.idx];
    setTabs((t) => t.map((tab) => tab.id === activeTabId ? { ...tab, url: next } : tab));
    setAddressBar(next);
  };

  // Cmd+K / Ctrl+K → open quick-open palette.
  // Uses capture phase + paneRef containment check so the global workspace
  // Cmd+K palette is NOT triggered when focus is inside the browser pane.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "k") return;
      if (!paneRef.current?.contains(e.target as Node)) return;
      e.stopPropagation();
      e.preventDefault();
      setQuickOpen((v) => !v);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  return (
    <div ref={paneRef} className="flex h-full flex-row" style={{ background: "#0c0c0e" }}>
      {/* ── Vertical tab rail ─────────────────────────────────────── */}
      {/* No right border — a `--border-hairline` (5% white) on the dark
         #0c0c0e viewport reads as a bright vertical line at the rail/page
         seam. The rail's darker `bg-[#080809]` already provides enough
         contrast against the viewport for visual separation. */}
      <div className="browser-tab-rail flex flex-col items-center bg-[#080809] py-1.5" style={{ width: 48, minWidth: 48 }}>
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          const title = shortTitle(tab.url, tabTitles[tab.id] ?? tab.title);
          const isLocalhost = tab.kind === "localhost";
          return (
            <div
              key={tab.id}
              role="button"
              tabIndex={0}
              onClick={() => switchTab(tab.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  switchTab(tab.id);
                }
              }}
              title={tabTitles[tab.id] ?? tab.title ?? tab.url}
              className={[
                "browser-tab group relative flex flex-col items-center justify-center gap-0.5 w-full cursor-pointer select-none transition-colors py-2.5",
                isActive
                  ? "bg-[#14141a] text-[--fg-base]"
                  : "text-[--fg-muted] hover:bg-[#0f0f13] hover:text-[--fg-base]",
              ].join(" ")}
            >
              {/* Active indicator bar */}
              {isActive && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-6 rounded-r-full bg-white/70" />
              )}
              {/* Favicon / indicator */}
              <span className="relative flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] bg-[--bg-raised]/50">
                {isLocalhost
                  ? <span className="h-2 w-2 rounded-full bg-green-400" />
                  : <span className="text-[9px] font-semibold leading-none text-[--fg-muted] uppercase">{title.slice(0,2)}</span>
                }
              </span>
              {/* Label */}
              <span className="w-[36px] truncate text-center text-[9px] leading-tight">{title}</span>
              {/* Close on hover */}
              {tab.kind === "pinned" && tabs.filter((t) => t.kind === "pinned").length > 1 && (
                <button
                  onClick={(e) => removeTab(tab.id, e)}
                  className="absolute top-1 right-1 opacity-0 group-hover:opacity-60 hover:!opacity-100 text-[--fg-muted] transition-opacity"
                  title="Close tab"
                >
                  <Icon name="ph:x-bold" width={7} />
                </button>
              )}
            </div>
          );
        })}
        {/* Spacer */}
        <div className="flex-1" />
        {/* Pin current page */}
        <button
          onClick={pinCurrentPage}
          className="grid h-8 w-8 shrink-0 place-items-center rounded text-[--fg-muted] hover:bg-[--bg-raised] hover:text-[--fg-base] transition-colors"
          title="Pin current page as a tab"
        >
          <Icon name="ph:plus" width={13} />
        </button>
      </div>

      {/* ── Main area (toolbar + viewport) ──────────────────────── */}
      <div className="flex flex-1 flex-col overflow-hidden">
      {/* ── Toolbar ───────────────────────────────────────────────── */}
      <header className="flex items-center gap-1 border-b border-[--border-hairline] bg-[--bg-raised]/40 px-2 py-1.5">
        {/* Back */}
        <button type="button" onClick={goBack} disabled={!canBack}
          className="grid h-7 w-7 place-items-center rounded text-[--fg-muted] hover:bg-[--bg-raised] hover:text-[--fg-base] disabled:opacity-30 disabled:cursor-default"
          title="Back" aria-label="Back">
          <Icon name="ph:arrow-left-bold" width={13} />
        </button>
        {/* Forward */}
        <button type="button" onClick={goForward} disabled={!canForward}
          className="grid h-7 w-7 place-items-center rounded text-[--fg-muted] hover:bg-[--bg-raised] hover:text-[--fg-base] disabled:opacity-30 disabled:cursor-default"
          title="Forward" aria-label="Forward">
          <Icon name="ph:arrow-right-bold" width={13} />
        </button>
        {/* Reload */}
        <button type="button"
          onClick={() => {
            if (bridge) void bridge.invoke("browser_reload", { label: tabLabel(activeTabId) });
            else navigateTo(activeUrl);
          }}
          className="grid h-7 w-7 place-items-center rounded text-[--fg-muted] hover:bg-[--bg-raised] hover:text-[--fg-base]"
          title={loading ? "Stop" : "Reload"} aria-label={loading ? "Stop" : "Reload"}>
          {loading
            ? <Icon name="ph:x-bold" width={12} />
            : <Icon name="ph:arrows-clockwise-bold" width={12} />}
        </button>
        {/* Address bar */}
        <form
          onSubmit={(e) => { e.preventDefault(); navigateTo(addressBar); }}
          className="flex flex-1 items-center gap-1 rounded-md border border-[--border-hairline] bg-[--bg-raised]/40 px-2 py-1 focus-within:border-[--accent-presence]"
        >
          {activeUrl.startsWith("https://") && (
            <Icon name="ph:lock-simple-bold" width={11} className="shrink-0 text-[--fg-muted]" />
          )}
          <input
            type="text"
            value={addressBar}
            onChange={(e) => setAddressBar(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            placeholder="Search or enter address"
            className="flex-1 bg-transparent text-[12px] text-[--fg-base] outline-none"
          />
        </form>
        {/* Home */}
        <button type="button" onClick={() => navigateTo(HOME_URL)}
          className="grid h-7 w-7 place-items-center rounded text-[--fg-muted] hover:bg-[--bg-raised] hover:text-[--fg-base]"
          title="Home" aria-label="Home">
          <Icon name="ph:house-bold" width={13} />
        </button>
        {/* Open in system browser */}
        <button type="button"
          onClick={() => {
            if (bridge) {
              void bridge.invoke("shell_open", { url: activeUrl }).catch(() => {
                window.open(activeUrl, "_blank", "noopener");
              });
            } else {
              window.open(activeUrl, "_blank", "noopener");
            }
          }}
          className="grid h-7 w-7 place-items-center rounded text-[--fg-muted] hover:bg-[--bg-raised] hover:text-[--fg-base]"
          title="Open in system browser" aria-label="Open in system browser">
          <Icon name="ph:arrow-square-out" width={13} />
        </button>
      </header>

      {/* ── Loading bar ───────────────────────────────────────────── */}
      {loading && (
        <div className="h-0.5 w-full overflow-hidden bg-[--bg-raised]">
          <div
            className="h-full animate-[browser-progress_1.4s_ease-in-out_infinite] bg-[--accent-presence]"
            style={{ width: "60%" }}
          />
        </div>
      )}

      {/* ── Viewport (webview overlay target) ─────────────────────── */}
      <div className="relative flex-1 overflow-hidden" style={{ background: "#0c0c0e" }}>
        {quickOpen && (
          <BrowserQuickOpen
            tabs={tabs}
            activeId={activeTabId}
            onSelect={switchTab}
            onClose={() => setQuickOpen(false)}
          />
        )}
        {unavailable ? (
          <iframe
            src={activeUrl}
            title="Browser"
            className="absolute inset-0 h-full w-full border-0 bg-[#0c0c0e]"
            sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-top-navigation"
          />
        ) : (
          <div ref={surfaceRef} className="absolute inset-0" />
        )}
      </div>
      </div>{/* end main area */}
    </div>
  );
}
