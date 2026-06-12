type DataHandler = (bytes: Uint8Array) => void;
type ExitHandler = (code: number) => void;
type CloseHandler = (code: number, reason: string) => void;

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

      ws.addEventListener("open", () => {
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

  dispose(): void {
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
