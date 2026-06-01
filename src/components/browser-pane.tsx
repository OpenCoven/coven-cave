"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/lib/icon";

// Browser pane — uses Tauri's child WebviewBuilder under the hood. A real
// Chromium webview is overlaid on top of the placeholder <div> below; we
// track the div's viewport-relative bounds with a ResizeObserver and call
// `browser_set_bounds` so the overlay stays aligned during resize, scroll,
// or layout changes.
//
// In `next dev` outside Tauri there's no webview — we render a small note.

type TauriBridge = {
  invoke: <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
};

async function loadTauri(): Promise<TauriBridge | null> {
  if (typeof window === "undefined") return null;
  // @ts-expect-error Tauri runtime
  if (!window.__TAURI_INTERNALS__) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return { invoke };
}

const DEFAULT_URL = "https://covenmeow.com";

export function BrowserPane({ label = "default" }: { label?: string }) {
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const [url, setUrl] = useState<string>(DEFAULT_URL);
  const [pendingUrl, setPendingUrl] = useState<string>(DEFAULT_URL);
  const [bridge, setBridge] = useState<TauriBridge | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  // One-time: pull in the Tauri bridge if we're inside the app.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const b = await loadTauri();
      if (cancelled) return;
      if (!b) setUnavailable(true);
      else setBridge(b);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Keep the native webview's bounds in sync with the placeholder div.
  // Run on every layout: ResizeObserver on the div, plus window resize +
  // scroll on the whole document (the parent app can resize panes).
  useEffect(() => {
    if (!bridge) return;
    const surface = surfaceRef.current;
    if (!surface) return;

    let raf = 0;
    const sync = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const rect = surface.getBoundingClientRect();
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

  // First navigation when the bridge becomes available; subsequent ones via go().
  useEffect(() => {
    if (!bridge) return;
    const surface = surfaceRef.current;
    if (!surface) return;
    const rect = surface.getBoundingClientRect();
    void bridge.invoke("browser_navigate", {
      label,
      url,
      x: rect.left,
      y: rect.top,
      w: rect.width,
      h: rect.height,
    });
  }, [bridge, label, url]);

  const go = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    let next = trimmed;
    if (!/^https?:\/\//i.test(next)) {
      next = `https://${next}`;
    }
    setUrl(next);
  };

  return (
    <div className="flex h-full flex-col bg-[--bg-base]">
      <header className="flex items-center gap-2 border-b border-[--border-hairline] bg-[--bg-raised]/40 px-3 py-1.5">
        <button
          type="button"
          onClick={() => bridge && go(url)}
          className="grid h-6 w-6 place-items-center rounded text-[--text-secondary] hover:bg-[--bg-raised] hover:text-[--text-primary]"
          title="Reload"
          aria-label="Reload"
        >
          <Icon name="ph:arrows-clockwise-bold" width={12} />
        </button>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            go(pendingUrl);
          }}
          className="flex-1"
        >
          <input
            type="text"
            value={pendingUrl}
            onChange={(e) => setPendingUrl(e.target.value)}
            placeholder="Address"
            className="w-full rounded-md border border-[--border-hairline] bg-[--bg-raised]/40 px-2 py-1 text-[12px] text-[--text-primary] outline-none focus:border-[--accent-presence]"
          />
        </form>
      </header>
      <div className="relative flex-1 overflow-hidden">
        {unavailable ? (
          <div className="flex h-full items-center justify-center text-[11px] text-[--text-muted]">
            Browser is only available inside the CovenCave desktop app.
          </div>
        ) : (
          <div ref={surfaceRef} className="absolute inset-0" />
        )}
      </div>
    </div>
  );
}
