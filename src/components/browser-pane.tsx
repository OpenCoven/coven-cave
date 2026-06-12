"use client";

import React, { useEffect, useRef, useState, useCallback, forwardRef, useImperativeHandle } from "react";
import { Icon } from "@/lib/icon";
import { IconButton } from "@/components/ui/icon-button";
import { BrowserQuickOpen } from "@/components/browser-quick-open";
import { useTauriPlatform } from "@/lib/tauri-platform";

// ── Favicon helpers (mirrors open-sesame FaviconService pattern) ──────────────
// Primary: Google S2 API (works from renderer, no CORS)
// Fallback: colored initial chip (mirrors ColoredInitialAvatar from open-sesame)

function faviconUrl(url: string): string {
  try {
    const host = new URL(url).hostname;
    return `https://www.google.com/s2/favicons?domain=${host}&sz=32`;
  } catch {
    return "";
  }
}

const INITIAL_COLORS = [
  "#5b5bd6", "#7c3aed", "#db2777", "#ea580c",
  "#16a34a", "#0891b2", "#4f46e5", "#0d9488",
];

function initialColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return INITIAL_COLORS[Math.abs(hash) % INITIAL_COLORS.length];
}

function TabFavicon({ url, title, size = 20 }: { url: string; title: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const src = faviconUrl(url);
  const initial = (title || url).trim().slice(0, 1).toUpperCase() || "?";
  const color = initialColor(title || url);

  if (!src || failed) {
    return (
      <span
        className="flex shrink-0 items-center justify-center rounded-[5px] text-[10px] font-semibold text-white"
        style={{ width: size, height: size, background: color }}
      >
        {initial}
      </span>
    );
  }
  return (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      className="rounded-[5px] object-contain"
      style={{ imageRendering: "auto" }}
      onError={() => setFailed(true)}
    />
  );
}

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
const NATIVE_BROWSER_LABEL_PREFIX = "cave-browser-";
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

  // Preserve existing convenience behavior first.
  let candidate = trimmed;
  if (/^localhost(:\d+)?(\/.*)?$/i.test(trimmed)) {
    candidate = `http://${trimmed}`;
  } else if (/^[a-z0-9-]+\.[a-z]{2,}/i.test(trimmed) && !/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    candidate = `https://${trimmed}`;
  }

  // Only allow http(s) URLs to reach the iframe src.
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.toString();
    }
  } catch {
    // fall through to safe search
  }

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
    { id: "opencvn-x", url: "https://x.com/OpenCvn", title: "OpenCvn", pinned: true, kind: "pinned" },
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

function SaveToLibraryButton({
  url, title, activeFamiliar,
}: { url: string | null; title: string; activeFamiliar: string | null }) {
  const [state, setState] = useState<"idle" | "saving" | "saved" | "dedup" | "err">("idle");
  if (!url) return null;

  const handleSave = async () => {
    if (!activeFamiliar) return;
    setState("saving");
    try {
      const res = await fetch("/api/library/route-link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url,
          source: { kind: "browser", tabUrl: url, tabTitle: title },
          familiar: activeFamiliar,
        }),
      });
      const json = await res.json() as { ok: boolean; deduped?: boolean };
      if (!json.ok) setState("err");
      else if (json.deduped) setState("dedup");
      else setState("saved");
    } catch { setState("err"); }
    finally { setTimeout(() => setState("idle"), 3000); }
  };

  if (state === "saved") {
    return (
      <IconButton icon="ph:check-bold" aria-label="Save to library" title="Saved" onClick={handleSave} />
    );
  }
  if (state === "dedup") {
    return (
      <IconButton icon="ph:bookmark-simple-fill" aria-label="Save to library" title="Already in library" onClick={handleSave} />
    );
  }
  return (
    <IconButton icon="ph:bookmark-simple" aria-label="Save to library" title="Save to library" onClick={handleSave} />
  );
}


export type BrowserPaneHandle = {
  navigateTo: (url: string) => void;
};

export const BrowserPane = forwardRef<BrowserPaneHandle, { label?: string; activeFamiliarId?: string | null }>(function BrowserPane({ label = "default", activeFamiliarId = null }: { label?: string; activeFamiliarId?: string | null }, ref: React.Ref<BrowserPaneHandle>) {
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const paneRef = useRef<HTMLDivElement | null>(null);
  const [bridge, setBridge] = useState<TauriBridge | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const platform = useTauriPlatform();
  useEffect(() => {
    // browser_* Rust commands are cfg(desktop)-gated. On Tauri-mobile
    // (iOS / Android) and in the browser, the embedded webview path
    // isn't reachable — drop to the iframe fallback that's already
    // rendered when `unavailable` is true.
    if (platform === "ios" || platform === "android" || platform === "browser") {
      setUnavailable(true);
    }
  }, [platform]);

  // Tab state
  const [tabs, setTabs] = useState<BrowserTab[]>(() => loadPinnedTabs());
  const [activeTabId, setActiveTabId] = useState<string>(() => loadPinnedTabs()[0]?.id ?? "home");
  const [tabTitles, setTabTitles] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [addressBar, setAddressBar] = useState<string>(HOME_URL);
  const [quickOpen, setQuickOpen] = useState(false);
  const [railHover, setRailHover] = useState(false);
  const [railPinned, setRailPinned] = useState(false);
  // Rail expands on hover/focus and stays expanded while the quick-open
  // palette is up so users can verify the active tab visually.
  const railExpanded = railPinned || railHover || quickOpen;

  // Collapsible toolbar. The native page webview is an OS-level overlay that
  // always renders above the DOM, so the toolbar and the page can never
  // coexist in the same space. Default collapsed: the page gets the whole
  // pane. When the toolbar is opened (rail button / Cmd+L) we hide the webview
  // so the toolbar shows cleanly, then restore the full-pane page on close.
  const [toolbarOpen, setToolbarOpen] = useState(false);
  const toolbarOpenRef = useRef(false);
  toolbarOpenRef.current = toolbarOpen;
  const addressInputRef = useRef<HTMLInputElement | null>(null);

  // History per-tab
  const historyRef = useRef<Record<string, { stack: string[]; idx: number }>>({});

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0];
  const activeUrl = activeTab?.url ?? HOME_URL;

  function tabLabel(tabId: string) {
    return `${label}-tab-${tabId}`;
  }

  function nativeTabLabelPrefix() {
    return `${NATIVE_BROWSER_LABEL_PREFIX}${label}-tab-`;
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
        const eventPrefix = nativeTabLabelPrefix();
        if (!evLabel.startsWith(eventPrefix)) return;
        const tabId = evLabel.slice(eventPrefix.length);
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
        const eventPrefix = nativeTabLabelPrefix();
        if (!evLabel.startsWith(eventPrefix)) return;
        const tabId = evLabel.slice(eventPrefix.length);
        setTabTitles((prev) => ({ ...prev, [tabId]: title }));
        if (tabId === activeTabId) setAddressBar(evUrl);
      },
    ).then((fn) => { unlistenTitle = fn; });

    return () => { unlistenLoad?.(); unlistenTitle?.(); };
  }, [bridge, label, activeTabId]);

  // ── Sync active tab webview bounds ────────────────────────────────
  // The native Tauri child webview is an OS-level overlay rendered ABOVE
  // the DOM, so it must track `surface`'s viewport rect exactly or it
  // rides up and covers the toolbar row above it. A ResizeObserver only
  // reacts to SIZE changes — a sibling reflow that MOVES the surface
  // without resizing it (e.g. a shell banner appearing/dismissing above
  // the pane, or the cave-mode-fade mount animation) leaves the overlay
  // stale and overlapping the toolbar. Reconcile against the live rect
  // every frame instead, issuing IPC only when the rounded bounds change.
  useEffect(() => {
    if (!bridge) return;
    const surface = surfaceRef.current;
    if (!surface) return;

    const tabIds = tabs.map((t) => t.id);
    let raf = 0;
    let hidden = false;
    let last = { x: 0, y: 0, w: 0, h: 0 };

    const hideAll = () => {
      tabIds.forEach((id) => {
        void bridge.invoke("browser_hide", { label: tabLabel(id) });
      });
    };

    const tick = () => {
      const rect = surface.getBoundingClientRect();
      // Hide every webview when the panel is collapsed OR the toolbar is open.
      // The toolbar is DOM and the webview is an OS-level overlay that would
      // cover it, so the page yields the pane while the toolbar is showing.
      if (toolbarOpenRef.current || rect.width <= 1 || rect.height <= 1) {
        if (!hidden) {
          hidden = true;
          hideAll();
        }
      } else {
        const next = {
          x: Math.round(rect.left), y: Math.round(rect.top),
          w: Math.round(rect.width), h: Math.round(rect.height),
        };
        if (
          hidden ||
          next.x !== last.x || next.y !== last.y ||
          next.w !== last.w || next.h !== last.h
        ) {
          last = next;
          hidden = false;
          // Show active tab at the live rect, hide others.
          tabIds.forEach((id) => {
            if (id === activeTabId) {
              void bridge.invoke("browser_set_bounds", { label: tabLabel(id), ...next });
            } else {
              void bridge.invoke("browser_hide", { label: tabLabel(id) });
            }
          });
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      hideAll();
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
    setToolbarOpen(false);
  }, [tabs]);

  // Clicking the pane's empty chrome — anything that isn't an interactive
  // control — toggles the rail pinned-open, giving the pin button a large,
  // forgiving hit target. The page is a native overlay that never delivers
  // clicks to the DOM, so in practice this fires on the rail, the footer, and
  // the toolbar background (when open) — never the page itself.
  const handleChromeClick = useCallback((e: React.MouseEvent) => {
    if (quickOpen) return;
    const target = e.target as HTMLElement;
    if (target.closest('button, a, input, textarea, select, form, [role="button"]')) return;
    setRailPinned((v) => !v);
  }, [quickOpen]);

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
    // Reveal the page again now that the user has committed a destination.
    setToolbarOpen(false);
  };

  useImperativeHandle(ref, () => ({ navigateTo }), [navigateTo]);

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

  // `[` → toggle rail pin (scoped to pane focus, mirroring Cmd+K).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "[") return;
      if (!paneRef.current?.contains(e.target as Node)) return;
      const target = e.target as HTMLElement;
      const tag = target.tagName?.toLowerCase();
      if (["input", "textarea", "select"].includes(tag) || target.isContentEditable) return;
      e.preventDefault();
      setRailPinned((v) => !v);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  // Cmd/Ctrl+L → open the toolbar & focus the address bar; Escape → close it.
  // (While the page webview holds focus the main window can't see these keys —
  // the rail's address button is the always-available trigger.)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const inPane = !!paneRef.current?.contains(e.target as Node);
      if ((e.metaKey || e.ctrlKey) && (e.key === "l" || e.key === "L")) {
        if (!inPane) return;
        e.preventDefault();
        setToolbarOpen(true);
      } else if (e.key === "Escape" && toolbarOpenRef.current && inPane) {
        e.preventDefault();
        setToolbarOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  // Focus the address bar when the toolbar opens (after the slide-down).
  useEffect(() => {
    if (!toolbarOpen) return;
    const t = setTimeout(() => addressInputRef.current?.focus(), 60);
    return () => clearTimeout(t);
  }, [toolbarOpen]);

  return (
    <div ref={paneRef} onClick={handleChromeClick} className="browser-pane flex h-full flex-row" style={{ background: "var(--bg-base)" }}>
      {/* ── Vertical tab rail (auto-hide) ─────────────────────── */}
      {/* Collapsed by default to a 6px edge handle so the page gets the
         full viewport width; expands to 48px on hover or keyboard focus.
         No right border — the rail's oklch(0.11 0.022 293) already provides enough
         contrast against oklch(0.13 0.022 293) without a hairline.
         Cmd+K (handled below) remains the primary tab-switcher. */}
      <div
        className={[
          "browser-tab-rail group/rail relative flex flex-col items-center bg-[var(--bg-panel)] py-1.5",
          "transition-[width] duration-150 ease-out",
          "w-3.5 hover:w-12 focus-within:w-12",
          railExpanded ? "!w-12" : "",
        ].join(" ")}
        style={{ minWidth: railExpanded ? 48 : 14 }}
        onMouseEnter={() => setRailHover(true)}
        onMouseLeave={() => setRailHover(false)}
        aria-label="Browser tabs"
      >
        {/* Tabs only render their content when the rail is expanded so
            collapsed-state mouse targets stay tiny and the page is not
            visually crowded. The rail itself remains hoverable in both
            states because the parent <div> keeps its full height. */}
        <div
          className={[
            "flex w-full flex-1 flex-col items-center transition-opacity duration-150",
            railExpanded ? "opacity-100" : "pointer-events-none opacity-0",
          ].join(" ")}
        >
          {/* Pin/unpin toggle at the very top of the rail */}
          <button
            type="button"
            onClick={() => setRailPinned((v) => !v)}
            title={railPinned ? "Auto-hide tabs" : "Pin tabs open"}
            className={[
              "focus-ring mb-1 grid h-7 w-7 shrink-0 place-items-center rounded transition-colors",
              railPinned
                ? "text-[var(--accent-presence)] hover:text-[var(--accent-presence)]"
                : "text-[var(--text-muted)] hover:text-[var(--text-primary)]",
            ].join(" ")}
          >
            <Icon name={railPinned ? "ph:sidebar-simple-fill" : "ph:sidebar-simple"} width={13} />
          </button>
          {/* Address bar / toolbar toggle. Lives in the rail because the page
              webview covers the rest of the pane; this strip never is. */}
          <button
            type="button"
            onClick={() => setToolbarOpen((v) => !v)}
            title="Address bar (⌘L)"
            aria-label="Toggle address bar"
            className={[
              "focus-ring mb-1 grid h-7 w-7 shrink-0 place-items-center rounded transition-colors",
              toolbarOpen
                ? "text-[var(--accent-presence)] hover:text-[var(--accent-presence)]"
                : "text-[var(--text-muted)] hover:text-[var(--text-primary)]",
            ].join(" ")}
          >
            <Icon name="ph:magnifying-glass" width={13} />
          </button>
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
                "focus-ring-inset browser-tab group relative flex flex-col items-center justify-center gap-0.5 w-full cursor-pointer select-none transition-colors py-2.5",
                isActive
                  ? "bg-[var(--bg-elevated)] text-[var(--fg-base)]"
                  : "text-[var(--fg-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--fg-base)]",
              ].join(" ")}
            >
              {/* Active indicator bar */}
              {isActive && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-6 rounded-r-full bg-[var(--accent-presence)]" />
              )}
              {/* Favicon / indicator */}
              <span className="relative flex shrink-0 items-center justify-center">
                {isLocalhost
                  ? <span className="h-2 w-2 rounded-full bg-green-400" />
                  : <TabFavicon url={tab.url} title={tabTitles[tab.id] ?? tab.title ?? title} size={20} />
                }
              </span>
              {/* Label — only when rail is expanded; favicon-only when collapsed */}
              {railExpanded ? (
                <span className="w-[44px] truncate text-center text-[10px] leading-tight">{title}</span>
              ) : null}
              {/* Close on hover */}
              {tab.kind === "pinned" && tabs.filter((t) => t.kind === "pinned").length > 1 && (
                <button
                  onClick={(e) => removeTab(tab.id, e)}
                  className="touch-always-visible focus-ring absolute top-1 right-1 rounded opacity-0 group-hover:opacity-60 hover:!opacity-100 focus-visible:opacity-100 text-[var(--fg-muted)] transition-opacity"
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
          className="focus-ring grid h-8 w-8 shrink-0 place-items-center rounded text-[var(--fg-muted)] hover:bg-[var(--bg-raised)] hover:text-[var(--fg-base)] transition-colors"
          title="Pin current page as a tab"
        >
          <Icon name="ph:plus" width={13} />
        </button>
        </div>{/* end rail content (collapsible) */}
      </div>

      {/* ── Main area (toolbar + viewport) ──────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      {/* ── Viewport (full-pane webview target) + collapsible toolbar ── */}
      <div className="relative min-h-0 flex-1 overflow-hidden" style={{ background: "var(--bg-base)" }}>
        {/* Toolbar — absolute overlay that slides down when open. The page
            webview is hidden while it's open (see the bounds sync), so the
            DOM toolbar and the native overlay never fight for the same space. */}
        <header
          className={[
            "absolute inset-x-0 top-0 z-30 flex min-h-10 items-center gap-1",
            "border-b border-[var(--border-hairline)] bg-[var(--bg-raised)] px-2 py-1.5",
            "transition-transform duration-150 ease-out",
            toolbarOpen ? "translate-y-0" : "pointer-events-none -translate-y-full",
          ].join(" ")}
          aria-hidden={!toolbarOpen}
        >
          {/* Back */}
          <button type="button" onClick={goBack} disabled={!canBack}
            className="focus-ring grid h-7 w-7 place-items-center rounded text-[var(--fg-muted)] hover:bg-[var(--bg-raised)] hover:text-[var(--fg-base)] disabled:opacity-30 disabled:cursor-default"
            title="Back" aria-label="Back">
            <Icon name="ph:arrow-left-bold" width={13} />
          </button>
          {/* Forward */}
          <button type="button" onClick={goForward} disabled={!canForward}
            className="focus-ring grid h-7 w-7 place-items-center rounded text-[var(--fg-muted)] hover:bg-[var(--bg-raised)] hover:text-[var(--fg-base)] disabled:opacity-30 disabled:cursor-default"
            title="Forward" aria-label="Forward">
            <Icon name="ph:arrow-right-bold" width={13} />
          </button>
          {/* Reload */}
          <button type="button"
            onClick={() => {
              if (bridge) void bridge.invoke("browser_reload", { label: tabLabel(activeTabId) });
              else navigateTo(activeUrl);
            }}
            className="focus-ring grid h-7 w-7 place-items-center rounded text-[var(--fg-muted)] hover:bg-[var(--bg-raised)] hover:text-[var(--fg-base)]"
            title={loading ? "Stop" : "Reload"} aria-label={loading ? "Stop" : "Reload"}>
            {loading
              ? <Icon name="ph:x-bold" width={12} />
              : <Icon name="ph:arrows-clockwise-bold" width={12} />}
          </button>
          {/* Address bar */}
          <form
            onSubmit={(e) => { e.preventDefault(); navigateTo(addressBar); }}
            className="flex flex-1 items-center gap-1 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)]/40 px-2 py-1 focus-within:border-[var(--accent-presence)]"
          >
            {activeUrl.startsWith("https://") && (
              <Icon name="ph:lock-simple-bold" width={11} className="shrink-0 text-[var(--fg-muted)]" />
            )}
            <input
              ref={addressInputRef}
              type="text"
              value={addressBar}
              onChange={(e) => setAddressBar(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              placeholder="Search or enter address"
              className="focus-ring-inset flex-1 rounded bg-transparent text-[12px] text-[var(--fg-base)]"
            />
          </form>
          {/* Home */}
          <button type="button" onClick={() => navigateTo(HOME_URL)}
            className="focus-ring grid h-7 w-7 place-items-center rounded text-[var(--fg-muted)] hover:bg-[var(--bg-raised)] hover:text-[var(--fg-base)]"
            title="Home" aria-label="Home">
            <Icon name="ph:house-bold" width={13} />
          </button>
          {/* Save to library */}
          <SaveToLibraryButton
            url={activeTab?.url ?? null}
            title={tabTitles[activeTabId] ?? activeTab?.title ?? ""}
            activeFamiliar={activeFamiliarId}
          />
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
            className="focus-ring grid h-7 w-7 place-items-center rounded text-[var(--fg-muted)] hover:bg-[var(--bg-raised)] hover:text-[var(--fg-base)]"
            title="Open in system browser" aria-label="Open in system browser">
            <Icon name="ph:arrow-square-out" width={13} />
          </button>
          {/* Close toolbar — restores the full-pane page */}
          <button type="button" onClick={() => setToolbarOpen(false)}
            className="focus-ring grid h-7 w-7 place-items-center rounded text-[var(--fg-muted)] hover:bg-[var(--bg-raised)] hover:text-[var(--fg-base)]"
            title="Close (Esc)" aria-label="Close address bar">
            <Icon name="ph:x-bold" width={12} />
          </button>
        </header>

        {/* Loading bar — sits just under the toolbar while it's open */}
        {loading && toolbarOpen && (
          <div className="absolute inset-x-0 top-10 z-30 h-0.5 overflow-hidden bg-[var(--bg-raised)]">
            <div
              className="h-full animate-[browser-progress_1.4s_ease-in-out_infinite] bg-[var(--accent-presence)]"
              style={{ width: "60%" }}
            />
          </div>
        )}

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
            className="absolute inset-0 h-full w-full border-0 bg-[var(--bg-base)]"
            sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-top-navigation"
          />
        ) : (
          <div ref={surfaceRef} className="absolute inset-0" />
        )}
      </div>
      <footer
        className="shrink-0 border-t border-[var(--border-hairline)] px-3 py-1.5 text-center text-[10px] text-[var(--text-muted)]"
      >
        ⌘L address · ⌘K tabs · ⌘[ back · ⌘] forward · ⌘R reload · [ pin rail
      </footer>
      </div>{/* end main area */}
    </div>
  );
});
