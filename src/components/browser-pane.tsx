"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/lib/icon";

// Browser pane — uses Tauri's child WebviewBuilder under the hood. A real
// Chromium webview is overlaid on top of the placeholder <div> below; we
// track the div's viewport-relative bounds with a ResizeObserver and call
// `browser_set_bounds` so the overlay stays aligned during resize, scroll,
// or layout changes.
//
// In `next dev` outside Tauri there's no webview — we render a fallback iframe.

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

function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return HOME_URL;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  // Bare domain (e.g. "google.com") → https://
  if (/^[a-z0-9-]+\.[a-z]{2,}/i.test(trimmed)) return `https://${trimmed}`;
  // Search query
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
}

export function BrowserPane({ label = "default" }: { label?: string }) {
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const [url, setUrl] = useState<string>(HOME_URL);
  const [addressBar, setAddressBar] = useState<string>(HOME_URL);
  const [bridge, setBridge] = useState<TauriBridge | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [loading, setLoading] = useState(false);
  // History stack for back/forward
  const historyRef = useRef<string[]>([HOME_URL]);
  const historyIdxRef = useRef<number>(0);

  // One-time: pull in the Tauri bridge.
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

  // Listen for page-load events from the native webview so the address bar
  // stays in sync when the user clicks links inside the browser.
  useEffect(() => {
    if (!bridge) return;
    let unlistenLoad: (() => void) | null = null;
    let unlistenTitle: (() => void) | null = null;
    void bridge.listen<{ label: string; url: string; phase: string }>(
      "browser:page-load",
      (e) => {
        const { label: evLabel, url: evUrl, phase } = e.payload;
        if (evLabel !== `cave-browser-${label}`) return;
        if (phase === "started") {
          setLoading(true);
        } else {
          setLoading(false);
          // Update address bar + push to history
          setAddressBar(evUrl);
          setUrl(evUrl);
          historyRef.current = [
            ...historyRef.current.slice(0, historyIdxRef.current + 1),
            evUrl,
          ];
          historyIdxRef.current = historyRef.current.length - 1;
        }
      },
    ).then((fn) => { unlistenLoad = fn; });
    void bridge.listen<{ label: string; title: string; url: string }>(
      "browser:title",
      (e) => {
        const { label: evLabel, url: evUrl } = e.payload;
        if (evLabel !== `cave-browser-${label}`) return;
        setAddressBar(evUrl);
      },
    ).then((fn) => { unlistenTitle = fn; });
    return () => { unlistenLoad?.(); unlistenTitle?.(); };
  }, [bridge, label]);

  // Keep the native webview's bounds in sync with the placeholder div.
  useEffect(() => {
    if (!bridge) return;
    const surface = surfaceRef.current;
    if (!surface) return;

    let raf = 0;
    const sync = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const rect = surface.getBoundingClientRect();
        // Panel collapsed (⌘J) — move webview offscreen instead of
        // setting 0-size bounds which can cause a visible flash.
        if (rect.width <= 1 || rect.height <= 1) {
          void bridge.invoke("browser_hide", { label });
          return;
        }
        void bridge.invoke("browser_set_bounds", {
          label,
          x: rect.left,
          y: rect.top,
          w: rect.width,
          h: rect.height,
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
      void bridge.invoke("browser_hide", { label });
    };
  }, [bridge, label]);

  // Navigate to `url` whenever it changes.
  useEffect(() => {
    if (!bridge) return;
    const surface = surfaceRef.current;
    if (!surface) return;
    const rect = surface.getBoundingClientRect();
    setLoading(true);
    void bridge.invoke("browser_navigate", {
      label,
      url,
      x: rect.left,
      y: rect.top,
      w: rect.width,
      h: rect.height,
    });
  }, [bridge, label, url]);

  const navigateTo = (raw: string) => {
    const next = normalizeUrl(raw);
    historyRef.current = [
      ...historyRef.current.slice(0, historyIdxRef.current + 1),
      next,
    ];
    historyIdxRef.current = historyRef.current.length - 1;
    setUrl(next);
    setAddressBar(next);
  };

  const goBack = () => {
    if (historyIdxRef.current <= 0) return;
    historyIdxRef.current -= 1;
    const prev = historyRef.current[historyIdxRef.current];
    setUrl(prev);
    setAddressBar(prev);
  };

  const goForward = () => {
    if (historyIdxRef.current >= historyRef.current.length - 1) return;
    historyIdxRef.current += 1;
    const next = historyRef.current[historyIdxRef.current];
    setUrl(next);
    setAddressBar(next);
  };

  const canBack = historyIdxRef.current > 0;
  const canForward = historyIdxRef.current < historyRef.current.length - 1;

  return (
    <div className="flex h-full flex-col bg-[--bg-base]">
      {/* ── Toolbar ───────────────────────────────────────────────── */}
      <header className="flex items-center gap-1 border-b border-[--border-hairline] bg-[--bg-raised]/40 px-2 py-1.5">
        {/* Back */}
        <button
          type="button"
          onClick={goBack}
          disabled={!canBack}
          className="grid h-7 w-7 place-items-center rounded text-[--text-secondary] hover:bg-[--bg-raised] hover:text-[--text-primary] disabled:opacity-30 disabled:cursor-default"
          title="Back"
          aria-label="Back"
        >
          <Icon name="ph:arrow-left-bold" width={13} />
        </button>
        {/* Forward */}
        <button
          type="button"
          onClick={goForward}
          disabled={!canForward}
          className="grid h-7 w-7 place-items-center rounded text-[--text-secondary] hover:bg-[--bg-raised] hover:text-[--text-primary] disabled:opacity-30 disabled:cursor-default"
          title="Forward"
          aria-label="Forward"
        >
          <Icon name="ph:arrow-right-bold" width={13} />
        </button>
        {/* Reload / Stop */}
        <button
          type="button"
          onClick={() => {
            if (bridge) {
              void bridge.invoke("browser_reload", { label });
            } else {
              navigateTo(url);
            }
          }}
          className="grid h-7 w-7 place-items-center rounded text-[--text-secondary] hover:bg-[--bg-raised] hover:text-[--text-primary]"
          title={loading ? "Stop" : "Reload"}
          aria-label={loading ? "Stop" : "Reload"}
        >
          {loading
            ? <Icon name="ph:x-bold" width={12} />
            : <Icon name="ph:arrows-clockwise-bold" width={12} />}
        </button>
        {/* Address bar */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            navigateTo(addressBar);
          }}
          className="flex flex-1 items-center gap-1 rounded-md border border-[--border-hairline] bg-[--bg-raised]/40 px-2 py-1 focus-within:border-[--accent-presence]"
        >
          {/* Security icon */}
          {url.startsWith("https://") && (
            <Icon name="ph:lock-simple-bold" width={11} className="shrink-0 text-[--text-tertiary]" />
          )}
          <input
            type="text"
            value={addressBar}
            onChange={(e) => setAddressBar(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            placeholder="Search or enter address"
            className="flex-1 bg-transparent text-[12px] text-[--text-primary] outline-none"
          />
        </form>
        {/* Home */}
        <button
          type="button"
          onClick={() => navigateTo(HOME_URL)}
          className="grid h-7 w-7 place-items-center rounded text-[--text-secondary] hover:bg-[--bg-raised] hover:text-[--text-primary]"
          title="Home"
          aria-label="Home"
        >
          <Icon name="ph:house-bold" width={13} />
        </button>
        {/* Open in system browser */}
        <button
          type="button"
          onClick={() => {
            // bridge.invoke shell_open if available, else window.open
            if (bridge) {
              void bridge.invoke("shell_open", { url }).catch(() => {
                window.open(url, "_blank", "noopener");
              });
            } else {
              window.open(url, "_blank", "noopener");
            }
          }}
          className="grid h-7 w-7 place-items-center rounded text-[--text-secondary] hover:bg-[--bg-raised] hover:text-[--text-primary]"
          title="Open in system browser"
          aria-label="Open in system browser"
        >
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

      {/* ── Viewport ──────────────────────────────────────────────── */}
      <div className="relative flex-1 overflow-hidden">
        {unavailable ? (
          <iframe
            src={url}
            title="Browser"
            className="absolute inset-0 h-full w-full border-0 bg-white"
            sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-top-navigation"
          />
        ) : (
          <div ref={surfaceRef} className="absolute inset-0" />
        )}
      </div>
    </div>
  );
}
