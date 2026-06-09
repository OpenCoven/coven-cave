"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Bottom terminal pane — xterm.js in the browser, hooked up to a
// portable-pty session on the Rust side (see src-tauri/src/pty.rs).
//
// Only mounts inside the Tauri webview. In `next dev` outside Tauri the
// pty.* commands aren't available, so we render a small placeholder
// instead of trying to invoke and erroring out.

// Screen-reader mirror: xterm renders to a <canvas>, which is opaque to AT.
// We keep an offscreen text mirror of recent PTY output (ANSI stripped) and
// expose it as a polite live region. Capped + debounced so fast streams
// (e.g. `cargo build`) don't flood SR or thrash React.
const MIRROR_LINES = 50;
const MIRROR_DEBOUNCE_MS = 250;

function stripAnsi(text: string): string {
  return text
    // CSI: ESC [ params letter
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "")
    // OSC: ESC ] ... BEL or ESC \
    .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, "")
    // Other C0 control chars except newline (\n=0x0a) and tab (\x09).
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "");
}

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
  // Keep a ref to projectRoot so the PTY-start effect always reads the latest
  // value, even when it arrives asynchronously after initial mount.
  const projectRootRef = useRef<string | undefined>(projectRoot);
  useEffect(() => { projectRootRef.current = projectRoot; }, [projectRoot]);
  const [unavailable, setUnavailable] = useState(false);
  // Screen-reader mirror state: see comment block near top of file.
  const [mirrorLines, setMirrorLines] = useState<string[]>([]);
  const pendingMirrorRef = useRef<string>("");
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const decoderRef = useRef<TextDecoder | null>(null);
  if (!decoderRef.current) {
    decoderRef.current = new TextDecoder("utf-8", { fatal: false });
  }

  const flushMirror = useCallback(() => {
    flushTimerRef.current = null;
    const pending = pendingMirrorRef.current;
    pendingMirrorRef.current = "";
    if (!pending) return;
    setMirrorLines((prev) => {
      const combined = (prev.join("\n") + pending).split("\n");
      return combined.slice(-MIRROR_LINES);
    });
  }, []);

  const pushToMirror = useCallback(
    (bytes: Uint8Array) => {
      if (!decoderRef.current) return;
      const text = stripAnsi(
        decoderRef.current.decode(bytes, { stream: true }),
      );
      if (!text) return;
      pendingMirrorRef.current += text;
      if (flushTimerRef.current == null) {
        flushTimerRef.current = setTimeout(flushMirror, MIRROR_DEBOUNCE_MS);
      }
    },
    [flushMirror],
  );

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
      // Skip all logs in browser dev — only log when Tauri is actually present
      const inTauri = typeof window !== "undefined" && !!(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
      if (inTauri) log("mount: loading tauri bridge");
      const bridge = await loadTauri();
      if (!bridge) {
        // Running outside Tauri (browser dev) — skip logging, just show placeholder
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
          background: "oklch(0.11 0.022 293)",
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
        const bytes = new Uint8Array(e.payload.bytes);
        term.write(bytes);
        pushToMirror(bytes);
      });
      const unlistenExit = await bridge.listen<{
        thread_id: string;
        code: number | null;
      }>("pty:exit", (e) => {
        if (e.payload.thread_id !== threadId) return;
        log("pty:exit", e.payload);
        stopped = true;
        const exitMsg = `\r\n\x1b[2m[exit ${e.payload.code ?? 0}]\x1b[0m\r\n`;
        term.write(exitMsg);
        pushToMirror(new TextEncoder().encode(exitMsg));
      });
      log("pty:data + pty:exit listeners registered");

      // Pipe user input back to the PTY.
      // Tauri command parameters are camelCase on the JS side by default.
      // The nested pty_start options object below is a Rust struct, so its
      // fields intentionally stay snake_case for Serde.
      const onDataDispose = term.onData((data) => {
        if (stopped) return;
        void bridge.invoke("pty_write", {
          threadId: threadId,
          bytes: Array.from(new TextEncoder().encode(data)),
        }).catch((err) => log("pty_write FAILED", err));
      });

      const running = await bridge.invoke<string[]>("pty_list").catch((err) => {
        log("pty_list FAILED", err);
        return [] as string[];
      });
      log("pty_list →", running);
      if (!running.includes(threadId)) {
        log("pty_start: invoking with projectRoot=", projectRootRef.current);
        try {
          await bridge.invoke("pty_start", {
            options: {
              thread_id: threadId,
              project_root: projectRootRef.current ?? null,
              cols: term.cols,
              rows: term.rows,
            },
          });
          log("pty_start: ok");
        } catch (err) {
          // Rare race: another mount beat us between pty_list and pty_start.
          if (!String(err).includes("already running")) {
            log("pty_start FAILED", err);
            const failMsg = `\r\n\x1b[31mpty_start failed: ${String(err)}\x1b[0m\r\n`;
            term.write(failMsg);
            pushToMirror(new TextEncoder().encode(failMsg));
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
            threadId: threadId,
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
        if (flushTimerRef.current) {
          clearTimeout(flushTimerRef.current);
          flushTimerRef.current = null;
        }
        pendingMirrorRef.current = "";
        termRef.current = null;
        term.dispose();
        void bridge.invoke("pty_stop", { threadId: threadId });
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
    <>
      <div
        ref={wrapRef}
        className="h-full w-full overflow-hidden"
        style={{ background: "oklch(0.11 0.022 293)", padding: "6px 8px" }}
        // Clicking anywhere in the terminal area refocuses xterm so keyboard
        // input is routed correctly without the user having to click exactly
        // on the cursor.
        onClick={() => termRef.current?.focus()}
      />
      {/* Offscreen text mirror of PTY output for screen readers. */}
      <div
        className="sr-only"
        role="region"
        aria-live="polite"
        aria-atomic="false"
        aria-label="Terminal output"
      >
        {mirrorLines.map((line, i) => (
          <div key={i}>{line}</div>
        ))}
      </div>
    </>
  );
}
