"use client";

import { useEffect, useRef, useState } from "react";

// Bottom terminal pane — xterm.js in the browser, hooked up to a
// portable-pty session on the Rust side (see src-tauri/src/pty.rs).
//
// Only mounts inside the Tauri webview. In `next dev` outside Tauri the
// pty.* commands aren't available, so we render a small placeholder
// instead of trying to invoke and erroring out.

type TauriBridge = {
  invoke: <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
  listen: <T>(
    event: string,
    handler: (e: { payload: T }) => void,
  ) => Promise<() => void>;
};

async function loadTauri(): Promise<TauriBridge | null> {
  if (typeof window === "undefined") return null;
  // @ts-expect-error Tauri injects this at runtime
  if (!window.__TAURI_INTERNALS__) return null;
  const [{ invoke }, { listen }] = await Promise.all([
    import("@tauri-apps/api/core"),
    import("@tauri-apps/api/event"),
  ]);
  return { invoke, listen };
}

export function BottomTerminal({
  threadId,
  active = true,
  projectRoot,
}: {
  threadId: string;
  active?: boolean;
  projectRoot?: string;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const fitRef = useRef<(() => void) | null>(null);
  const termRef = useRef<import("@xterm/xterm").Terminal | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const log = (...a: unknown[]) => {
    console.info(`[BottomTerminal:${threadId}]`, ...a);
    try {
      const inv = (typeof window !== "undefined" ? window : ({} as any))
        .__TAURI_INTERNALS__?.invoke;
      if (typeof inv === "function") {
        inv("webview_probe_report", {
          report: JSON.stringify({
            kind: "bottom-terminal-log",
            threadId,
            msg: a
              .map((x) => (typeof x === "string" ? x : JSON.stringify(x)))
              .join(" "),
            ts: new Date().toISOString(),
          }),
        }).catch(() => {});
      }
    } catch { /* ignore */ }
  };
  // Also forward every BottomTerminal log line back to Rust so we can read
  // them in the tauri-dev stderr without needing WebView devtools.

  // Re-fit + refocus whenever this terminal becomes the active tab.
  useEffect(() => {
    if (active) {
      const id = requestAnimationFrame(() => {
        fitRef.current?.();
        termRef.current?.focus();
      });
      return () => cancelAnimationFrame(id);
    }
  }, [active]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;

    let disposed = false;
    let cleanup: (() => void) | null = null;

    void (async () => {
      log("mount: loading tauri bridge");
      const bridge = await loadTauri();
      if (!bridge) {
        log("mount: no tauri bridge — running outside Cave; rendering placeholder");
        if (!disposed) setUnavailable(true);
        return;
      }
      log("mount: tauri bridge ready");

      // Lazy-load xterm only on the client + only inside Tauri so SSR and
      // the in-browser dev path don't try to pull it in.
      const [{ Terminal }, { FitAddon }, { WebLinksAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
        import("@xterm/addon-web-links"),
      ]);

      const term = new Terminal({
        fontFamily:
          'ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
        fontSize: 12,
        lineHeight: 1.2,
        cursorBlink: true,
        theme: {
          background: "#16131f",
          foreground: "#e6e6f0",
          cursor: "#9a8ecd",
          selectionBackground: "rgba(154,142,205,0.35)",
        },
      });
      termRef.current = term;
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.loadAddon(new WebLinksAddon());
      term.open(wrap);
      try {
        fit.fit();
      } catch {
        /* DOM not ready yet — first resize event will recover */
      }
      log("xterm opened", { cols: term.cols, rows: term.rows });

      let stopped = false;
      const unlistenData = await bridge.listen<{
        thread_id: string;
        bytes: number[];
      }>("pty:data", (e) => {
        if (e.payload.thread_id !== threadId) return;
        log("pty:data", e.payload.bytes.length, "bytes");
        term.write(new Uint8Array(e.payload.bytes));
      });
      const unlistenExit = await bridge.listen<{
        thread_id: string;
        code: number | null;
      }>("pty:exit", (e) => {
        if (e.payload.thread_id !== threadId) return;
        log("pty:exit", e.payload);
        stopped = true;
        term.write(`\r\n\x1b[2m[exit ${e.payload.code ?? 0}]\x1b[0m\r\n`);
      });
      log("pty:data + pty:exit listeners registered");

      // Pipe user input back to the PTY.
      // NOTE: Tauri v2 invoke does NOT auto-convert camelCase → snake_case;
      // param names must match the Rust fn signature exactly.
      const onDataDispose = term.onData((data) => {
        if (stopped) return;
        log("onData → pty_write", data.length, "chars");
        void bridge.invoke("pty_write", {
          thread_id: threadId,
          bytes: Array.from(new TextEncoder().encode(data)),
        }).catch((err) => log("pty_write FAILED", err));
      });

      const running = await bridge.invoke<string[]>("pty_list").catch((err) => {
        log("pty_list FAILED", err);
        return [] as string[];
      });
      log("pty_list →", running);
      if (!running.includes(threadId)) {
        log("pty_start: invoking with projectRoot=", projectRoot);
        try {
          await bridge.invoke("pty_start", {
            options: {
              thread_id: threadId,
              project_root: projectRoot ?? null,
              cols: term.cols,
              rows: term.rows,
            },
          });
          log("pty_start: ok");
        } catch (err) {
          // Rare race: another mount beat us between pty_list and pty_start.
          if (!String(err).includes("already running")) {
            log("pty_start FAILED", err);
            term.write(`\r\n\x1b[31mpty_start failed: ${String(err)}\x1b[0m\r\n`);
          } else {
            log("pty_start: already running for this id (ok)");
          }
        }
      } else {
        log("pty_start: skipped, already in pty_list");
      }
      term.focus();

      const doResize = () => {
        try {
          fit.fit();
          void bridge.invoke("pty_resize", {
            thread_id: threadId,
            cols: term.cols,
            rows: term.rows,
          });
        } catch { /* harmless mid-tear-down */ }
      };

      // Refit on container size changes.
      const ro = new ResizeObserver(doResize);
      ro.observe(wrap);

      // Store fit+resize so the active-tab effect can trigger a refit + refocus.
      fitRef.current = () => {
        doResize();
        term.focus();
      };

      cleanup = () => {
        ro.disconnect();
        onDataDispose.dispose();
        unlistenData();
        unlistenExit();
        termRef.current = null;
        term.dispose();
        void bridge.invoke("pty_stop", { thread_id: threadId });
      };

      if (disposed) cleanup();
    })();

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [threadId]);

  if (unavailable) {
    return (
      <div className="flex h-full items-center justify-center text-[11px] text-[var(--text-muted)]">
        Terminal is only available inside the CovenCave desktop app.
      </div>
    );
  }

  return (
    <div
      ref={wrapRef}
      className="h-full w-full overflow-hidden"
      style={{ background: "#16131f", padding: "6px 8px" }}
      // Clicking anywhere in the terminal area refocuses xterm so keyboard
      // input is routed correctly without the user having to click exactly
      // on the cursor.
      onClick={() => termRef.current?.focus()}
    />
  );
}
