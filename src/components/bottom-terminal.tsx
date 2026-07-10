"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTauriPlatform } from "@/lib/tauri-platform";
import { useIsCoarsePointer } from "@/lib/use-viewport";
import { usePrefersReducedMotion } from "@/lib/use-prefers-reduced-motion";
import { TerminalKeyBar } from "@/components/terminal-key-bar";
import { PtyWsBridge } from "@/lib/pty-ws-bridge";
import { Icon } from "@/lib/icon";
import { useAnnouncer } from "@/components/ui/live-region";

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
// While the pane is hidden (keepalive) the mirror isn't re-rendered; cap the
// buffered text so a busy background stream can't grow it without bound before
// the pane is next shown (the flush trims to MIRROR_LINES anyway).
const MIRROR_PENDING_CAP = 16384;
// ResizeObserver fires every frame during a divider drag / window resize, and
// each callback used to push pty_resize immediately — a SIGWINCH storm to the
// shell (and to every hidden keepalive pane, which keeps full size at inset:0).
// The local xterm refit stays per-callback for smooth visuals; only the PTY
// push is throttled to this window, and skipped when the size didn't change.
const RESIZE_PUSH_DEBOUNCE_MS = 150;
// The xterm lazy-import + PTY handshake is "a few seconds"; well past that with
// no connection means startup hung (a wedged native command, a transport await
// that never settled, or `platform` never resolving off "unknown"). Surface a
// Retry rather than spinning forever.
const START_WATCHDOG_MS = 15_000;

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

function themeColorToken(name: string): string {
  if (typeof window === "undefined") return `var(${name})`;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || `var(${name})`;
}

function searchDecorations() {
  const warning = themeColorToken("--color-warning");
  const accent = themeColorToken("--accent-presence");
  return {
    matchBackground: warning,
    activeMatchBackground: accent,
    matchOverviewRuler: warning,
    activeMatchColorOverviewRuler: accent,
  } as const;
}

type XtermBundle = {
  term: import("@xterm/xterm").Terminal;
  fit: import("@xterm/addon-fit").FitAddon;
  search: import("@xterm/addon-search").SearchAddon;
};

// Shared resize handling for both transports: refit the local xterm on every
// observer callback (cheap; keeps the canvas crisp during divider drags), but
// throttle the PTY push (SIGWINCH to the shell) to RESIZE_PUSH_DEBOUNCE_MS and
// skip it for hidden panes and unchanged cols/rows. Hidden keepalive panes sit
// at inset:0 so they'd otherwise mirror every window resize straight to N
// background shells.
function makeResizer(
  term: import("@xterm/xterm").Terminal,
  fit: import("@xterm/addon-fit").FitAddon,
  isVisible: () => boolean,
  push: (cols: number, rows: number) => void,
) {
  let last = { cols: -1, rows: -1 };
  let timer: ReturnType<typeof setTimeout> | null = null;
  const fire = () => {
    timer = null;
    // Hidden pane: local fit already happened (so reveal is crisp); the PTY
    // learns the size on the next visible resize instead.
    if (!isVisible()) return;
    const { cols, rows } = term;
    if (cols === last.cols && rows === last.rows) return;
    last = { cols, rows };
    push(cols, rows);
  };
  const doResize = () => {
    try {
      fit.fit();
    } catch { /* harmless mid-tear-down */ }
    if (timer == null) timer = setTimeout(fire, RESIZE_PUSH_DEBOUNCE_MS);
  };
  const dispose = () => {
    if (timer != null) {
      clearTimeout(timer);
      timer = null;
    }
  };
  return { doResize, dispose };
}

// Build the xterm instance + addons shared by both transports (Tauri IPC and the
// WebSocket bridge). The two effects differ only in how bytes flow to/from the
// PTY; the terminal, fit/links/search addons, result reporting, and the ⌘F
// find-bar key handler are identical, so they live here once. JSX-free.
async function createXterm(
  wrap: HTMLDivElement,
  handlers: {
    /** SearchAddon result count changed — drives the n/N counter. */
    onResults: (index: number, count: number) => void;
    /** ⌘F / Ctrl+F pressed inside the terminal — open the find bar. */
    onRequestFind: () => void;
    /** prefers-reduced-motion at creation time — disables cursor blink. */
    reducedMotion?: boolean;
  },
): Promise<XtermBundle> {
  const [{ Terminal }, { FitAddon }, { WebLinksAddon }, { SearchAddon }] = await Promise.all([
    import("@xterm/xterm"),
    import("@xterm/addon-fit"),
    import("@xterm/addon-web-links"),
    import("@xterm/addon-search"),
  ]);

  const term = new Terminal({
    fontFamily:
      'ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
    fontSize: 12,
    lineHeight: 1.2,
    // A permanently blinking cursor is exactly the kind of continuous motion
    // prefers-reduced-motion opts out of; kept in sync after creation too.
    cursorBlink: !handlers.reducedMotion,
    // Required for the search addon's match decorations (highlights + count).
    allowProposedApi: true,
    theme: {
      background: "oklch(0.11 0.022 293)",
      foreground: "#e6e6f0",
      cursor: "#9a8ecd",
      selectionBackground: "rgba(154,142,205,0.35)",
    },
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.loadAddon(new WebLinksAddon());
  const search = new SearchAddon();
  term.loadAddon(search);
  search.onDidChangeResults((e) => {
    handlers.onResults(e.resultIndex >= 0 ? e.resultIndex + 1 : 0, e.resultCount);
  });
  // ⌘F / Ctrl+F opens the in-buffer find bar instead of the browser's.
  term.attachCustomKeyEventHandler((e) => {
    if (e.type === "keydown" && (e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "f") {
      e.preventDefault();
      handlers.onRequestFind();
      return false;
    }
    return true;
  });
  term.open(wrap);
  try {
    fit.fit();
  } catch {
    /* DOM not ready yet — first resize event will recover */
  }
  return { term, fit, search };
}

export function BottomTerminal({
  threadId,
  active = true,
  visible = active,
  projectRoot,
  paneId,
  label,
  registerWriter,
  onUserInput,
}: {
  threadId: string;
  /** This pane has keyboard focus (drives refit + refocus on activation). */
  active?: boolean;
  /** This pane is rendered on-screen. True for EVERY pane of a visible split
   *  (not just the focused one) so the screen-reader mirror keeps flowing for
   *  visible-but-unfocused panes; false only for hidden keepalive mounts.
   *  Defaults to `active` for single-pane hosts. */
  visible?: boolean;
  projectRoot?: string;
  /** Stable id for comux's broadcast registry (defaults to threadId). */
  paneId?: string;
  /** Human-readable pane name (the comux tab/pane label) so AT can tell split
   *  panes apart — names the terminal region and its screen-reader mirror. */
  label?: string;
  /** Register/unregister this pane's PTY writer so broadcast can fan input in. */
  registerWriter?: (paneId: string, write: ((data: string) => void) | null) => void;
  /** Called with every keystroke (post Ctrl-transform) so comux can mirror it
   *  to sibling panes when broadcast mode is on. */
  onUserInput?: (paneId: string, data: string) => void;
}) {
  const broadcastPaneId = paneId ?? threadId;
  // Connection transitions are written into the terminal (and its polite
  // mirror) as dim ANSI, where a disconnect can be buried under output — mirror
  // them to the shared assertive live region so AT interrupts with the status.
  const { announce: srAnnounce } = useAnnouncer();
  // Writer set by whichever transport (Tauri / WS) is live; the registered
  // wrapper reads this ref at call time so registration can precede attach.
  const writerRef = useRef<((data: string) => void) | null>(null);
  const onUserInputRef = useRef(onUserInput);
  onUserInputRef.current = onUserInput;
  useEffect(() => {
    if (!registerWriter) return;
    registerWriter(broadcastPaneId, (data: string) => writerRef.current?.(data));
    return () => registerWriter(broadcastPaneId, null);
  }, [registerWriter, broadcastPaneId]);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const fitRef = useRef<(() => void) | null>(null);
  const termRef = useRef<import("@xterm/xterm").Terminal | null>(null);
  // In-buffer search (⌘F): the SearchAddon searches the rendered scrollback —
  // read-only over the buffer, so it never touches the PTY transport.
  const searchRef = useRef<import("@xterm/addon-search").SearchAddon | null>(null);
  const findInputRef = useRef<HTMLInputElement | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findInfo, setFindInfo] = useState<{ index: number; count: number }>({ index: 0, count: 0 });
  // Ties the (non-live) match counter to the find input via aria-describedby.
  const findCountId = useId();
  // Touch accessory key bar: soft keyboards lack Esc/Tab/Ctrl/arrows. Only shown
  // on coarse pointers. Ctrl is sticky — the toggle flips ctrlStickyRef, and the
  // onData handler (set up once at mount) reads the ref to transform the next
  // typed character into its control code. clearCtrlRef lets that handler reset
  // the visual state from inside its stable closure.
  const isCoarse = useIsCoarsePointer();
  // Reactive: flipping the OS setting stops/starts the blink without a
  // remount (xterm applies option changes live). The ref feeds the async
  // createXterm calls so the initial value is right without re-running them.
  const reducedMotion = usePrefersReducedMotion();
  const reducedMotionRef = useRef(reducedMotion);
  reducedMotionRef.current = reducedMotion;
  useEffect(() => {
    const term = termRef.current;
    if (term) term.options.cursorBlink = !reducedMotion;
  }, [reducedMotion]);
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
  const runFind = useCallback((direction: 1 | -1, term?: string) => {
    const q = term ?? findInputRef.current?.value ?? "";
    if (!q) {
      searchRef.current?.clearDecorations();
      setFindInfo({ index: 0, count: 0 });
      return;
    }
    const opts = { decorations: searchDecorations() };
    if (direction === 1) searchRef.current?.findNext(q, opts);
    else searchRef.current?.findPrevious(q, opts);
  }, []);
  // Open the find bar and select its input. Shared by the ⌘F key handler and
  // the touch Find button (soft keyboards can't produce the ⌘F chord).
  const openFind = useCallback(() => {
    setFindOpen(true);
    requestAnimationFrame(() => findInputRef.current?.select());
  }, []);
  const closeFind = useCallback(() => {
    setFindOpen(false);
    searchRef.current?.clearDecorations();
    setFindInfo({ index: 0, count: 0 });
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
  // Startup never resolved — a thrown/hung transport await, or `platform` stuck
  // at "unknown" so neither transport effect ran. Surfaced (with Retry) instead
  // of an indefinite "Starting terminal…" spinner. `retryNonce` re-runs the
  // transport effects when the user retries.
  const [startError, setStartError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
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
  // Mirror `visible` into a ref so the byte handlers and resize observers
  // (registered once per mount) can read the current value without
  // re-subscribing. `active` (focus) deliberately does NOT gate the mirror:
  // a visible-but-unfocused split pane must keep announcing output.
  const visibleRef = useRef(visible);
  visibleRef.current = visible;

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
      // Keep decoding even while hidden so the streaming decoder state stays
      // consistent — but don't re-render the (sr-only, aria-live=polite) mirror
      // off-screen: a busy background stream otherwise re-rendered the 50-line
      // mirror every 250ms while the terminal wasn't even visible. Buffer
      // (bounded) and drain when the pane is next shown.
      const text = stripAnsi(
        decoderRef.current.decode(bytes, { stream: true }),
      );
      if (!text) return;
      pendingMirrorRef.current += text;
      if (!visibleRef.current) {
        if (pendingMirrorRef.current.length > MIRROR_PENDING_CAP) {
          pendingMirrorRef.current = pendingMirrorRef.current.slice(-MIRROR_PENDING_CAP);
        }
        return;
      }
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

  // Drain output buffered while the pane was hidden as soon as it's shown —
  // independent of focus, so every pane of a revealed split resumes announcing.
  useEffect(() => {
    if (visible) flushMirror();
  }, [visible, flushMirror]);

  // Re-fit + refocus whenever this terminal becomes the active (focused) pane.
  useEffect(() => {
    if (active) {
      const id = requestAnimationFrame(() => {
        fitRef.current?.();
        termRef.current?.focus();
      });
      return () => cancelAnimationFrame(id);
    }
  }, [active]);

  // Startup watchdog: covers every way the terminal can stall before `ready` —
  // a native pty_* command that never returns, a transport await that throws/
  // hangs, or `platform` stuck at "unknown" so neither transport effect runs.
  // Without this the user just stares at "Starting terminal…" forever.
  useEffect(() => {
    if (ready || unavailable || startError) return;
    const id = setTimeout(() => {
      setStartError("The terminal didn't finish starting — the shell backend isn't responding.");
      log("startup watchdog fired", { platform, retryNonce });
    }, START_WATCHDOG_MS);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, unavailable, startError, platform, retryNonce]);

  // Re-run the transport effects (retryNonce is in their deps) and reset the
  // overlay state so the watchdog re-arms.
  const retryStart = useCallback(() => {
    setStartError(null);
    setUnavailable(false);
    setReady(false);
    setRetryNonce((n) => n + 1);
  }, []);

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
     try {
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

      // Lazy-load + build xterm (only on the client + inside Tauri so SSR and
      // the in-browser dev path don't pull it in). Shared with the WS path.
      const { term, fit, search } = await createXterm(wrap, {
        onResults: (index, count) => setFindInfo({ index, count }),
        onRequestFind: openFind,
        reducedMotion: reducedMotionRef.current,
      });
      termRef.current = term;
      searchRef.current = search;
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
        onUserInputRef.current?.(broadcastPaneId, out);
      });
      writerRef.current = (d) =>
        void bridge.invoke("pty_write", {
          threadId: threadId,
          bytes: Array.from(new TextEncoder().encode(d)),
        }).catch((err) => log("pty_write FAILED", err));

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

      const resizer = makeResizer(term, fit, () => visibleRef.current, (cols, rows) => {
        void bridge.invoke("pty_resize", {
          threadId: threadId,
          cols,
          rows,
        }).catch(() => { /* harmless mid-tear-down */ });
      });
      const doResize = resizer.doResize;

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
        resizer.dispose();
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
        // keystrokes. The shell is killed exactly once, by the OWNER of the
        // thread id — the chat code rail stops `cave.rail.<id>` shells on
        // session switch (chat-surface.tsx, cave-c3yt).
      };

      if (disposed) cleanup();
     } catch (err) {
       // A thrown/rejected await (loadTauri, createXterm, listen, a native
       // command) must not leave the pane stuck on "Starting terminal…" — surface
       // it (with Retry) instead of hanging silently.
       if (!disposed) {
         log("desktop terminal startup FAILED", err);
         setStartError(`Terminal failed to start: ${String(err)}`);
       }
     }
    })();

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [threadId, platform, openFind, retryNonce]);

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
     try {
      const { term, fit, search } = await createXterm(wrap, {
        onResults: (index, count) => setFindInfo({ index, count }),
        onRequestFind: openFind,
        reducedMotion: reducedMotionRef.current,
      });
      termRef.current = term;
      searchRef.current = search;

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
              // Reset the streaming decoder (+ pending buffer) too: a mid-char
              // socket drop left partial bytes that would corrupt the mirror.
              decoderRef.current = new TextDecoder("utf-8", { fatal: false });
              pendingMirrorRef.current = "";
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
          srAnnounce("Terminal reconnect failed; press any key to retry", "assertive");
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
          srAnnounce("This terminal was opened in another window; this view is detached", "assertive");
          return;
        }
        if (reason === "pty exit") {
          // onExit already announced; a keypress starts a fresh shell.
          return;
        }
        announce("\r\n\x1b[2m[terminal disconnected — reconnecting…]\x1b[0m\r\n");
        srAnnounce("Terminal disconnected, reconnecting", "assertive");
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
        onUserInputRef.current?.(broadcastPaneId, data);
      });
      writerRef.current = (d) => bridge.write(new TextEncoder().encode(d));

      const resizer = makeResizer(term, fit, () => visibleRef.current, (cols, rows) => {
        try {
          bridge.resize(cols, rows);
        } catch { /* harmless mid-tear-down */ }
      });
      const doResize = resizer.doResize;

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
        resizer.dispose();
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
     } catch (err) {
       if (!disposed) {
         log("ws terminal startup FAILED", err);
         setStartError(`Terminal failed to start: ${String(err)}`);
       }
     }
    })();

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [threadId, platform, pushToMirror, openFind, retryNonce]);

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
        // xterm renders into an opaque <canvas>; label the region so AT can name
        // it (live output is exposed via the screen-reader mirror below). The
        // pane label keeps split panes distinguishable.
        role="group"
        aria-label={label ? `Terminal: ${label}` : "Terminal"}
        // Clicking anywhere in the terminal area refocuses xterm so keyboard
        // input is routed correctly without the user having to click exactly
        // on the cursor.
        onClick={() => termRef.current?.focus()}
      />
      {/* In-buffer find bar (⌘F) — searches the rendered scrollback. */}
      {findOpen ? (
        <div
          className="bottom-terminal-find absolute right-2 top-2 z-10 flex items-center gap-1.5 rounded-md border border-[var(--border-strong)] bg-[var(--bg-elevated)] px-2 py-1 shadow-lg"
          role="search"
          aria-label="Find in terminal"
        >
          <input
            ref={findInputRef}
            value={findQuery}
            onChange={(e) => {
              setFindQuery(e.target.value);
              runFind(1, e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") { e.preventDefault(); closeFind(); }
              else if (e.key === "Enter") { e.preventDefault(); runFind(e.shiftKey ? -1 : 1); }
            }}
            placeholder="Find in terminal…"
            aria-label="Find in terminal"
            aria-describedby={findCountId}
            className="focus-ring-inset w-44 bg-transparent text-[12px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
          />
          {/* Match counter is deliberately NOT a live region: the SR mirror
              region below is already aria-live=polite, and a second polite
              region updating on every keystroke produced double/overlapping
              announcements. aria-describedby on the input keeps the count
              discoverable to AT without competing announcements. */}
          <span
            id={findCountId}
            className="min-w-[34px] text-right text-[10px] tabular-nums text-[var(--text-muted)]"
          >
            {findInfo.count > 0 ? `${findInfo.index}/${findInfo.count}` : findQuery ? "0/0" : ""}
          </span>
          <button type="button" onClick={() => runFind(-1)} title="Previous match (⇧⏎)" aria-label="Previous match"
            className="focus-ring grid h-5 w-5 place-items-center rounded text-[var(--text-muted)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]">
            <Icon name="ph:caret-up" width={11} aria-hidden />
          </button>
          <button type="button" onClick={() => runFind(1)} title="Next match (⏎)" aria-label="Next match"
            className="focus-ring grid h-5 w-5 place-items-center rounded text-[var(--text-muted)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]">
            <Icon name="ph:caret-down" width={11} aria-hidden />
          </button>
          <button type="button" onClick={closeFind} title="Close (Esc)" aria-label="Close find"
            className="focus-ring grid h-5 w-5 place-items-center rounded text-[var(--text-muted)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]">
            <Icon name="ph:x-bold" width={11} aria-hidden />
          </button>
        </div>
      ) : null}
      {/* Overlay while the xterm lazy-loads and the PTY (native or WebSocket)
          connects — without it the pane reads as blank for a few seconds. If
          startup stalls or throws, it flips to a visible error + Retry instead
          of spinning forever. */}
      {!ready && startError ? (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center text-[11px] text-[var(--text-muted)]"
          style={{ background: "oklch(0.11 0.022 293)" }}
          role="alert"
        >
          <span className="max-w-[42ch] text-[var(--text-secondary)]">{startError}</span>
          <button
            type="button"
            onClick={retryStart}
            className="focus-ring rounded-md border border-[var(--border-strong)] bg-[var(--bg-elevated)] px-3 py-1 text-[11px] text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-raised)]"
          >
            Retry
          </button>
        </div>
      ) : !ready ? (
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
        <TerminalKeyBar onKey={sendKey} ctrlActive={ctrlActive} onToggleCtrl={toggleCtrl} onFind={openFind} />
      ) : null}
      {/* Offscreen text mirror of PTY output for screen readers. */}
      <div
        className="sr-only"
        role="region"
        aria-live="polite"
        aria-atomic="false"
        aria-label={label ? `Terminal output: ${label}` : "Terminal output"}
      >
        {mirrorLines.map((line, i) => (
          <div key={i}>{line}</div>
        ))}
      </div>
    </div>
  );
}
