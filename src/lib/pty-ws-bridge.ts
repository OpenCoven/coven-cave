type DataHandler = (bytes: Uint8Array) => void;
type ExitHandler = (code: number) => void;
type CloseHandler = (code: number, reason: string) => void;

// Fail a connect that never reaches OPEN. On iOS a WKWebView WebSocket opened
// right after the app resumes can hang in CONNECTING forever — no open, no
// error, no close event ever fires. Without this bound the reconnect loop
// awaits open() indefinitely and its `reconnecting` guard wedges the whole
// terminal pane (every keypress is silently dropped).
const CONNECT_TIMEOUT_MS = 8000;

// Registry of live WS bridges keyed by threadId, so an out-of-tree caller (the
// comux tab-close handler) can reap a shell without holding the bridge ref —
// the bridge is created and owned inside BottomTerminal.
const activeBridges = new Map<string, PtyWsBridge>();

/**
 * Explicit tab-close: tell the server to reap the shell for this threadId NOW,
 * instead of letting the socket close detach with a grace window (which leaks
 * the shell for minutes on the WS transport). No-op when no WS bridge is
 * registered for the threadId — e.g. the desktop native-IPC transport, which
 * reaps via `pty_stop` — so callers can invoke it unconditionally.
 */
export function killPtyBridge(threadId: string): void {
  activeBridges.get(threadId)?.kill();
}

export class PtyWsBridge {
  private ws: WebSocket | null = null;
  private dataHandlers: DataHandler[] = [];
  private exitHandlers: ExitHandler[] = [];
  private closeHandlers: CloseHandler[] = [];
  private lastConnect: {
    threadId: string;
    cols: number;
    rows: number;
    projectRoot?: string;
  } | null = null;

  onData(cb: DataHandler): void {
    this.dataHandlers.push(cb);
  }

  onExit(cb: ExitHandler): void {
    this.exitHandlers.push(cb);
  }

  /** Fires when an ESTABLISHED socket closes (never for connect failures —
   *  those reject connect() — and never for our own dispose()). The terminal
   *  uses this to tell the user and to drive reconnection; without it a
   *  dropped socket (sleep/wake, server restart) left a frozen pane that
   *  silently swallowed keystrokes. */
  onClose(cb: CloseHandler): void {
    this.closeHandlers.push(cb);
  }

  get isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  connect(threadId: string, cols: number, rows: number, projectRoot?: string): Promise<void> {
    this.lastConnect = { threadId, cols, rows, projectRoot };
    return this.open();
  }

  /** Re-dial with the parameters from the last connect(). The server adopts
   *  a still-running PTY for the same threadId (replaying recent output) or
   *  spawns a fresh shell if it was lost — either way typing works again. */
  reconnect(): Promise<void> {
    if (!this.lastConnect) {
      return Promise.reject(new Error("reconnect before connect"));
    }
    return this.open();
  }

  private open(): Promise<void> {
    const target = this.lastConnect;
    if (!target) return Promise.reject(new Error("no connect parameters"));
    activeBridges.set(target.threadId, this);
    // Tear down any prior socket before re-dialing. After an iOS app resume the
    // previous socket can be a zombie — readyState still reads OPEN but the
    // connection is dead, so it never fires close and silently swallows writes.
    // Replacing it unconditionally on reconnect avoids talking into that black
    // hole; the server adopts the running PTY for this threadId and replays.
    const prev = this.ws;
    this.ws = null;
    if (prev && prev.readyState !== WebSocket.CLOSED) {
      try {
        prev.close(1000, "reconnect");
      } catch {
        /* ignore */
      }
    }
    return new Promise((resolve, reject) => {
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const params = new URLSearchParams({
        threadId: target.threadId,
        cols: String(target.cols),
        rows: String(target.rows),
      });
      if (target.projectRoot) {
        params.set("projectRoot", target.projectRoot);
      }

      const url = `${proto}//${window.location.host}/api/pty-ws?${params}`;
      const ws = new WebSocket(url);
      let settled = false;
      ws.binaryType = "arraybuffer";
      this.ws = ws;

      // Connect watchdog (see CONNECT_TIMEOUT_MS): if the socket never reaches
      // OPEN, abandon the stalled connection and reject so the reconnect loop
      // can advance to its next backoff instead of hanging forever.
      const watchdog = setTimeout(() => {
        if (settled) return;
        settled = true;
        if (this.ws === ws) this.ws = null;
        try {
          ws.close(1000, "connect timeout");
        } catch {
          /* ignore */
        }
        reject(new Error("terminal websocket connect timed out"));
      }, CONNECT_TIMEOUT_MS);

      ws.addEventListener("open", () => {
        clearTimeout(watchdog);
        settled = true;
        resolve();
      });
      // WebSocket "error" events carry no diagnostics (rejecting with one
      // renders as "[object Event]"); the close event that follows carries
      // the code/reason. Wait for it so the terminal can say something
      // actionable.
      ws.addEventListener("error", () => {
        /* close fires next with the real detail */
      });
      ws.addEventListener("message", (event) => {
        if (!(event.data instanceof ArrayBuffer)) return;
        const buf = new Uint8Array(event.data);
        const tag = buf[0];
        if (tag === 0x01) {
          const payload = buf.slice(1);
          for (const cb of this.dataHandlers) cb(payload);
        } else if (tag === 0x02 && buf.length >= 5) {
          const view = new DataView(event.data, 1);
          const code = view.getInt32(0, true);
          for (const cb of this.exitHandlers) cb(code);
        }
      });
      ws.addEventListener("close", (event) => {
        clearTimeout(watchdog);
        const wasCurrent = this.ws === ws;
        if (wasCurrent) {
          this.ws = null;
        }
        if (!settled) {
          settled = true;
          const reason = event.reason ? ` — ${event.reason}` : "";
          reject(
            new Error(
              `the Cave server refused the terminal websocket (close ${event.code}${reason}). ` +
                "Restart the app; if this is a remote/mobile session, re-open it from a fresh handoff link.",
            ),
          );
          return;
        }
        // dispose() nulls this.ws before closing, so an intentional teardown
        // never reaches the handlers.
        if (wasCurrent) {
          for (const cb of this.closeHandlers) cb(event.code, event.reason ?? "");
        }
      });
    });
  }

  write(bytes: Uint8Array): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const frame = new Uint8Array(1 + bytes.length);
    frame[0] = 0x03;
    frame.set(bytes, 1);
    this.ws.send(frame);
  }

  resize(cols: number, rows: number): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const frame = new Uint8Array(5);
    frame[0] = 0x04;
    const view = new DataView(frame.buffer);
    view.setUint16(1, cols, true);
    view.setUint16(3, rows, true);
    this.ws.send(frame);
  }

  /**
   * Explicit tab-close: send the server a kill frame (0x05) so it reaps the
   * shell immediately rather than detaching with a grace window, then tear
   * down. Distinct from dispose() — a transient unmount / navigation, which must
   * leave the shell alive so a remount can reattach. Sent over the still-open
   * socket; close() below flushes it during the closing handshake.
   */
  kill(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(new Uint8Array([0x05]));
      } catch {
        // Socket went away mid-close — dispose() tears down below; the server's
        // detach grace still reaps the shell as a fallback.
      }
    }
    this.dispose();
  }

  dispose(): void {
    const threadId = this.lastConnect?.threadId;
    if (threadId && activeBridges.get(threadId) === this) {
      activeBridges.delete(threadId);
    }
    this.dataHandlers = [];
    this.exitHandlers = [];
    this.closeHandlers = [];
    const ws = this.ws;
    this.ws = null;
    if (ws && ws.readyState !== WebSocket.CLOSED) {
      ws.close(1000, "disposed");
    }
  }
}
