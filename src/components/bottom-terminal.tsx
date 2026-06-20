"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTauriPlatform } from "@/lib/tauri-platform";
import { useIsCoarsePointer } from "@/lib/use-viewport";
import { TerminalKeyBar } from "@/components/terminal-key-bar";
import { PtyWsBridge } from "@/lib/pty-ws-bridge";

// Bottom terminal pane — xterm.js in the browser, hooked up to a
// portable-pty session on the Rust side (see src-tauri/src/pty.rs).
//
// Desktop Tauri uses native pty.* commands. Browser dev/prod uses the
// WebSocket PTY bridge (server.ts /api/pty-ws). Tauri-mobile (iOS, Android)
// cannot spawn a local shell, but its webview points at a remote Cave
// server — so it rides the same WebSocket bridge and gets a shell there.

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
  // Touch accessory key bar: soft keyboards lack Esc/Tab/Ctrl/arrows. Only shown
  // on coarse pointers. Ctrl is sticky — the toggle flips ctrlStickyRef, and the
  // onData handler (set up once at mount) reads the ref to transform the next
  // typed character into its control code. clearCtrlRef lets that handler reset
  // the visual state from inside its stable closure.
  const isCoarse = useIsCoarsePointer();
  const [ctrlActive, setCtrlActive] = useState(false);
  const ctrlStickyRef = useRef(false);
  const clearCtrlRef = useRef<() => void>(() => {});
  clearCtrlRef.current = () => {
    ctrlStickyRef.current = false;
    setCtrlActive(false);
  };
  const sendKey = useCallback((seq: string) => {
    const term = termRef.current;
    if (!term) return;
    term.focus();
    term.input(seq);
  }, []);
  const toggleCtrl = useCallback(() => {
    setCtrlActive((on) => {
      const next = !on;
      ctrlStickyRef.current = next;
      return next;
    });
    termRef.current?.focus();
  }, []);
  const wsBridgeRef = useRef<PtyWsBridge | null>(null);
  // Keep a ref to projectRoot so the PTY-start effect always reads the latest
  // value, even when it arrives asynchronously after initial mount.
  const projectRootRef = useRef<string | undefined>(projectRoot);
  useEffect(() => { projectRootRef.current = projectRoot; }, [projectRoot]);
  const [unavailable, setUnavailable] = useState(false);
  // Goes true once the xterm is open and the PTY (native or WS) has connected.
  // Until then the pane shows a "Starting terminal…" overlay instead of looking
  // blank during the lazy xterm import + WebSocket handshake (~a few seconds).
  const [ready, setReady] = useState(false);
  // useTauriPlatform() resolves async and starts at "unknown". Desktop uses
  // Tauri IPC; browser dev/prod AND Tauri-mobile use the WebSocket PTY
  // bridge — the mobile webview is served by a remote Cave server, and the
  // bridge opens the shell on that machine.
  const platform = useTauriPlatform();
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
    // The pty.* Tauri commands are only registered on desktop. Browser and
    // Tauri-mobile use the WebSocket-bridge effect below instead.
    if (platform !== "desktop") return;
    setReady(false);

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
      // Attach-to-running comes first: tab switches remount this component
      // (the keepalive container is a different React parent), and the PTY
      // deliberately survives unmounts. Replaying the Rust-side scrollback
      // ring BEFORE registering the live listener restores the screen instead
      // of presenting a blank-but-alive shell. A byte that lands in the gap
      // between snapshot and listen is lost from the view (not the shell) —
      // acceptable for an idle tab switch.
      const running = await bridge.invoke<string[]>("pty_list").catch((err) => {
        log("pty_list FAILED", err);
        return [] as string[];
      });
      log("pty_list →", running);
      const attachToRunning = running.includes(threadId);
      if (attachToRunning) {
        const snapshot = await bridge
          .invoke<number[]>("pty_snapshot", { threadId: threadId })
          .catch(() => [] as number[]);
        if (snapshot.length > 0) {
          const bytes = new Uint8Array(snapshot);
          term.write(bytes);
          pushToMirror(bytes);
        }
      }
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
        let out = data;
        // Sticky Ctrl (mobile key bar): fold the next single character into its
        // C0 control code (Ctrl-C, Ctrl-A, …), then drop back to normal input.
        if (ctrlStickyRef.current && data.length === 1) {
          const code = data.toUpperCase().charCodeAt(0);
          if (code >= 0x40 && code <= 0x5f) out = String.fromCharCode(code & 0x1f);
          clearCtrlRef.current();
        }
        void bridge.invoke("pty_write", {
          threadId: threadId,
          bytes: Array.from(new TextEncoder().encode(out)),
        }).catch((err) => log("pty_write FAILED", err));
      });

      if (!attachToRunning) {
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
      if (!disposed) setReady(true);
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
        // Deliberately NO pty_stop here. Unmount is usually a tab switch
        // (keepalive reparenting), and the fire-and-forget stop raced the
        // next mount's pty_list — losing the race attached the new terminal
        // to a shell that was about to be SIGHUPed, a dead pane that ate
        // keystrokes. The shell is killed exactly once, when the user closes
        // the tab (ComuxView.removeSession).
      };

      if (disposed) cleanup();
    })();

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [threadId, platform]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    // Browser and Tauri-mobile both reach the shell through the WebSocket
    // bridge served by the Cave server the page was loaded from.
    if (platform !== "browser" && platform !== "ios" && platform !== "android") return;
    setReady(false);

    let disposed = false;
    let cleanup: (() => void) | null = null;

    void (async () => {
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

      const bridge = new PtyWsBridge();
      wsBridgeRef.current = bridge;

      const announce = (msg: string) => {
        term.write(msg);
        pushToMirror(new TextEncoder().encode(msg));
      };

      bridge.onData((bytes) => {
        term.write(bytes);
        pushToMirror(bytes);
      });
      bridge.onExit((code) => {
        announce(
          `\r\n\x1b[2m[exit ${code} — press any key to start a new shell]\x1b[0m\r\n`,
        );
      });

      // Reconnection: a dropped socket (laptop sleep, server restart, network
      // change) used to leave a frozen pane that silently swallowed
      // keystrokes — write() no-ops on a dead socket. Now the pane says so,
      // retries with a short backoff, and any keypress retries again. The
      // server keeps the PTY alive for a detach grace window and replays
      // recent output on reattach, so a quick drop loses nothing.
      const RECONNECT_DELAYS_MS = [0, 1000, 3000];
      let reconnecting = false;
      const attemptReconnect = async () => {
        if (reconnecting || disposed) return;
        reconnecting = true;
        try {
          for (const delay of RECONNECT_DELAYS_MS) {
            if (delay > 0) {
              await new Promise((r) => setTimeout(r, delay));
            }
            if (disposed) return;
            try {
              // The server replays its scrollback ring on reattach; reset
              // first so the replay paints a clean screen instead of
              // appending a duplicate of what's already visible.
              term.reset();
              await bridge.reconnect();
              bridge.resize(term.cols, term.rows);
              return;
            } catch {
              /* next delay */
            }
          }
          announce(
            "\r\n\x1b[2m[terminal reconnect failed — press any key to retry]\x1b[0m\r\n",
          );
        } finally {
          reconnecting = false;
        }
      };

      bridge.onClose((_code, reason) => {
        if (disposed) return;
        if (reason === "replaced") {
          announce(
            "\r\n\x1b[2m[this terminal was opened in another window — view detached]\x1b[0m\r\n",
          );
          return;
        }
        if (reason === "pty exit") {
          // onExit already announced; a keypress starts a fresh shell.
          return;
        }
        announce("\r\n\x1b[2m[terminal disconnected — reconnecting…]\x1b[0m\r\n");
        void attemptReconnect();
      });

      try {
        await bridge.connect(threadId, term.cols, term.rows, projectRootRef.current);
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        const failMsg = `\r\n\x1b[31mTerminal connection failed: ${detail}\x1b[0m\r\n`;
        term.write(failMsg);
        pushToMirror(new TextEncoder().encode(failMsg));
        if (!disposed) setReady(true); // clear the overlay so the error is visible
        return;
      }
      if (disposed) {
        bridge.dispose();
        term.dispose();
        return;
      }
      setReady(true);

      const onDataDispose = term.onData((data) => {
        if (!bridge.isOpen) {
          // Dead socket (or exited shell): typing revives the terminal
          // instead of vanishing into a no-op write.
          void attemptReconnect();
          return;
        }
        bridge.write(new TextEncoder().encode(data));
      });

      const doResize = () => {
        try {
          fit.fit();
          bridge.resize(term.cols, term.rows);
        } catch {
          /* harmless mid-tear-down */
        }
      };

      const ro = new ResizeObserver(doResize);
      ro.observe(wrap);

      // iOS/WKWebView suspends the WebSocket when the app is backgrounded and
      // routinely resumes with a dead-but-OPEN ("zombie") socket that never
      // fires close — so the onClose-driven reconnect never triggers and the
      // pane hangs. Re-dial on every foreground for iOS to guarantee a live
      // socket (the server adopts the running PTY and replays scrollback, so a
      // healthy reconnect is a cheap no-op to the user). Browser/Android keep a
      // tab-switch-surviving socket, so only redial there when it's truly down.
      const onForeground = () => {
        if (disposed) return;
        if (
          typeof document !== "undefined" &&
          document.visibilityState === "hidden"
        ) {
          return;
        }
        if (platform === "ios" || !bridge.isOpen) {
          void attemptReconnect();
        }
      };
      if (typeof document !== "undefined") {
        document.addEventListener("visibilitychange", onForeground);
      }
      window.addEventListener("pageshow", onForeground);
      window.addEventListener("focus", onForeground);

      fitRef.current = () => {
        doResize();
        term.focus();
      };
      term.focus();

      cleanup = () => {
        ro.disconnect();
        onDataDispose.dispose();
        if (typeof document !== "undefined") {
          document.removeEventListener("visibilitychange", onForeground);
        }
        window.removeEventListener("pageshow", onForeground);
        window.removeEventListener("focus", onForeground);
        if (flushTimerRef.current) {
          clearTimeout(flushTimerRef.current);
          flushTimerRef.current = null;
        }
        pendingMirrorRef.current = "";
        termRef.current = null;
        wsBridgeRef.current = null;
        bridge.dispose();
        term.dispose();
      };

      if (disposed) cleanup();
    })();

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [threadId, platform, pushToMirror]);

  if (unavailable) {
    return (
      <div className="flex h-full items-center justify-center text-[11px] text-[var(--text-muted)]">
        Terminal is not available on this device.
      </div>
    );
  }

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden">
      <div
        ref={wrapRef}
        className="min-h-0 w-full flex-1 overflow-hidden"
        style={{ background: "oklch(0.11 0.022 293)", padding: "6px 8px" }}
        // Clicking anywhere in the terminal area refocuses xterm so keyboard
        // input is routed correctly without the user having to click exactly
        // on the cursor.
        onClick={() => termRef.current?.focus()}
      />
      {/* Overlay while the xterm lazy-loads and the PTY (native or WebSocket)
          connects — without it the pane reads as blank for a few seconds. */}
      {!ready ? (
        <div
          className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 text-[11px] text-[var(--text-muted)]"
          style={{ background: "oklch(0.11 0.022 293)" }}
          role="status"
          aria-live="polite"
        >
          <span
            className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent"
            aria-hidden
          />
          Starting terminal…
        </div>
      ) : null}
      {/* Touch accessory bar — only on coarse pointers (phones/tablets), where
          the soft keyboard can't produce Esc/Tab/Ctrl/arrows. */}
      {isCoarse ? (
        <TerminalKeyBar onKey={sendKey} ctrlActive={ctrlActive} onToggleCtrl={toggleCtrl} />
      ) : null}
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
    </div>
  );
}
