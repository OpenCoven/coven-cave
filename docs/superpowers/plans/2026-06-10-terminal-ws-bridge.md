# Terminal WebSocket PTY Bridge — Implementation Plan
_2026-06-10 · coven-cave_

> **For agentic workers:** Execute all tasks in order. Each task ends with a TypeScript/build check + commit. Stop and ping Kitty on any error that doesn't resolve in 2 attempts.

**Goal:** Make the terminal work in any browser context (mobile web, desktop browser, dev server) by adding a WebSocket PTY bridge via `node-pty` and a custom Next.js server. Tauri desktop path stays unchanged.

**Spec:** `docs/superpowers/specs/2026-06-10-terminal-ws-bridge.md`

---

### Task 1: Install deps and update config

**Files:**
- Modify: `package.json`
- Modify: `next.config.ts`

- [ ] **Step 1: Install node-pty, ws, @types/ws**

```bash
cd ~/Documents/GitHub/OpenCoven/coven-cave
pnpm add node-pty ws
pnpm add -D @types/ws
```

- [ ] **Step 2: Add `serverExternalPackages` to `next.config.ts`**

In `next.config.ts`, add `serverExternalPackages` to the config object (before `experimental`):

```ts
serverExternalPackages: ["node-pty"],
```

- [ ] **Step 3: Add node-pty to `outputFileTracingIncludes` so standalone build includes it**

In the existing `outputFileTracingIncludes` block, add an entry for `**` or `"*"` key:

```ts
outputFileTracingIncludes: {
  "*": ["./node_modules/node-pty/**/*"],
  // ... existing entries ...
},
```

Read the current `outputFileTracingIncludes` block first and merge, don't replace.

- [ ] **Step 4: Verify TypeScript**

```bash
pnpm tsc --noEmit 2>&1 | tail -5
```
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml next.config.ts
git commit -m "feat(terminal): add node-pty + ws deps, configure serverExternalPackages"
```

---

### Task 2: Create `server.ts` — custom Next.js server with WS PTY upgrade handler

**Files:**
- Create: `server.ts` (repo root, alongside `package.json`)

- [ ] **Step 1: Create `server.ts`**

```ts
// Custom Next.js server that handles WebSocket PTY upgrades at /api/pty-ws.
// All other requests are forwarded to the standard Next.js request handler.
//
// Protocol (binary frames, 1-byte type tag):
//   server→client  0x01  PTY output bytes
//   server→client  0x02  PTY exit: 4-byte little-endian exit code
//   client→server  0x03  Input bytes to write to PTY
//   client→server  0x04  Resize: 2-byte cols LE + 2-byte rows LE
//
// Auth: coven_access_token cookie (same check as REST middleware).
// Shell is hardcoded server-side — no renderer-supplied command/args/env.

import { createServer, type IncomingMessage } from "node:http";
import { parse } from "node:url";
import { existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";

import next from "next";
import { WebSocketServer, type WebSocket } from "ws";

// node-pty is a native addon — load via createRequire so it isn't
// accidentally bundled by any build tool that processes this file.
const _require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pty: typeof import("node-pty") = _require("node-pty");

// ── Auth ──────────────────────────────────────────────────────────────────────

const ACCESS_TOKEN = process.env.COVEN_CAVE_ACCESS_TOKEN ?? "";
const ACCESS_COOKIE = "coven_access_token";

function getTokenFromCookie(header: string | undefined): string {
  if (!header) return "";
  for (const part of header.split(";")) {
    const [k, v] = part.trim().split("=");
    if (k === ACCESS_COOKIE) return decodeURIComponent(v ?? "");
  }
  return "";
}

function isAuthorised(req: IncomingMessage): boolean {
  if (!ACCESS_TOKEN) return true; // dev: no token configured → open
  const cookie = getTokenFromCookie(req.headers.cookie);
  if (cookie === ACCESS_TOKEN) return true;
  const auth = req.headers["authorization"] ?? "";
  if (auth.startsWith("Bearer ") && auth.slice(7) === ACCESS_TOKEN) return true;
  return false;
}

// ── Shell defaults ────────────────────────────────────────────────────────────

function defaultShell(): string {
  if (process.platform === "darwin") return "/bin/zsh";
  if (process.platform === "win32") {
    const ps = "C:\\Program Files\\PowerShell\\7\\pwsh.exe";
    return existsSync(ps) ? ps : "cmd.exe";
  }
  return process.env.SHELL ?? "/bin/bash";
}

function defaultShellArgs(): string[] {
  if (process.platform === "win32") return [];
  return ["-l"];
}

function augmentedPath(): string {
  const base = process.env.PATH ?? "";
  if (process.platform === "win32") return base;
  const extras = [
    "/opt/homebrew/bin",
    "/opt/homebrew/sbin",
    "/usr/local/bin",
    "/usr/local/sbin",
    "/usr/bin",
    "/bin",
  ];
  const seen = new Set(base.split(":").filter(Boolean));
  const parts = [...base.split(":").filter(Boolean)];
  for (const p of extras) {
    if (!seen.has(p)) { parts.push(p); seen.add(p); }
  }
  return parts.join(":");
}

// ── PTY session registry ──────────────────────────────────────────────────────

interface PtySession {
  pty: import("node-pty").IPty;
  ws: WebSocket;
}

const sessions = new Map<string, PtySession>();

function spawnPty(
  threadId: string,
  ws: WebSocket,
  cols: number,
  rows: number,
  projectRoot?: string,
): void {
  const cwd = validateCwd(projectRoot) ?? process.env.HOME ?? process.cwd();

  const shell = pty.spawn(defaultShell(), defaultShellArgs(), {
    name: "xterm-256color",
    cols: cols || 120,
    rows: rows || 40,
    cwd,
    env: {
      ...process.env,
      PATH: augmentedPath(),
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      COVENCAVE: "1",
      LANG: process.env.LANG ?? "en_US.UTF-8",
      LC_ALL: process.env.LC_ALL ?? "en_US.UTF-8",
    },
  });

  sessions.set(threadId, { pty: shell, ws });

  // PTY output → WS (tag 0x01)
  shell.onData((data) => {
    if (ws.readyState !== 1 /* OPEN */) return;
    const encoded = Buffer.from(data, "binary");
    const frame = Buffer.allocUnsafe(1 + encoded.length);
    frame[0] = 0x01;
    encoded.copy(frame, 1);
    ws.send(frame);
  });

  // PTY exit → WS (tag 0x02)
  shell.onExit(({ exitCode }) => {
    sessions.delete(threadId);
    if (ws.readyState === 1) {
      const frame = Buffer.allocUnsafe(5);
      frame[0] = 0x02;
      frame.writeInt32LE(exitCode ?? 0, 1);
      ws.send(frame);
      ws.close(1000, "pty exit");
    }
  });
}

function validateCwd(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const st = statSync(raw);
    return st.isDirectory() ? raw : undefined;
  } catch {
    return undefined;
  }
}

// ── WebSocket message handler ─────────────────────────────────────────────────

function onWsMessage(threadId: string, data: Buffer): void {
  const session = sessions.get(threadId);
  if (!session) return;
  const tag = data[0];
  if (tag === 0x03) {
    // Input bytes
    session.pty.write(data.slice(1).toString("binary"));
  } else if (tag === 0x04 && data.length >= 5) {
    // Resize
    const cols = data.readUInt16LE(1);
    const rows = data.readUInt16LE(3);
    if (cols > 0 && rows > 0) session.pty.resize(cols, rows);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOSTNAME ?? "0.0.0.0";
const port = parseInt(process.env.PORT ?? "3000", 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

await app.prepare();

const wss = new WebSocketServer({ noServer: true });

wss.on("connection", (ws, req, threadId: string, cols: number, rows: number, projectRoot?: string) => {
  if (sessions.has(threadId)) {
    // Already running — reattach (ws replaces old ws reference, PTY keeps running)
    const existing = sessions.get(threadId)!;
    existing.ws = ws;
  } else {
    spawnPty(threadId, ws, cols, rows, projectRoot);
  }

  ws.on("message", (data) => {
    if (Buffer.isBuffer(data)) onWsMessage(threadId, data);
  });

  ws.on("close", () => {
    const session = sessions.get(threadId);
    if (session) {
      sessions.delete(threadId);
      try { session.pty.kill(); } catch { /* already dead */ }
    }
  });
});

const server = createServer((req, res) => {
  const parsedUrl = parse(req.url ?? "/", true);
  void handle(req, res, parsedUrl);
});

server.on("upgrade", (req, socket, head) => {
  const { pathname, query } = parse(req.url ?? "/", true);
  if (pathname !== "/api/pty-ws") {
    socket.destroy();
    return;
  }
  if (!isAuthorised(req)) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }
  const threadId = String(query.threadId ?? "");
  if (!threadId) {
    socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
    socket.destroy();
    return;
  }
  const cols = parseInt(String(query.cols ?? "120"), 10);
  const rows = parseInt(String(query.rows ?? "40"), 10);
  const projectRoot = query.projectRoot ? String(query.projectRoot) : undefined;

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req, threadId, cols, rows, projectRoot);
  });
});

server.listen(port, hostname, () => {
  console.log(`> Ready on http://${hostname}:${port}`);
});
```

- [ ] **Step 2: Update `package.json` scripts to use the custom server**

Replace:
```json
"dev": "next dev",
"start": "next start"
```
With:
```json
"dev": "node --experimental-strip-types server.ts",
"start": "node server.js"
```

And add a `build:server` script that compiles `server.ts` to `server.js` for production:
```json
"build:server": "esbuild server.ts --bundle=false --platform=node --target=node22 --outfile=server.js --format=esm --external:node-pty --external:ws --external:next"
```

Check if `esbuild` is already a dep: `grep esbuild package.json`. If not, add: `pnpm add -D esbuild`.

- [ ] **Step 3: Add `"type": "module"` guard check**

Check if `package.json` already has `"type": "module"`:
```bash
grep '"type"' package.json
```
If not present, add `"type": "module"` to `package.json` (top-level). If it already has `"type": "commonjs"`, change to `"module"` — the server uses ESM `import.meta.url`.

- [ ] **Step 4: Verify server parses**

```bash
node --experimental-strip-types --input-type=module < server.ts 2>&1 | head -10
```

Expected: no parse errors (may hang waiting for input — Ctrl+C after a second is fine, we just want no syntax errors).

- [ ] **Step 5: Commit**

```bash
git add server.ts package.json pnpm-lock.yaml
git commit -m "feat(terminal): custom Next.js server with WebSocket PTY upgrade handler"
```

---

### Task 3: Create `src/lib/pty-ws-bridge.ts` — client-side WS PTY bridge

**Files:**
- Create: `src/lib/pty-ws-bridge.ts`

- [ ] **Step 1: Create the file**

```ts
// Client-side WebSocket bridge for the PTY server (server.ts).
//
// Protocol (binary frames):
//   server→client  0x01  PTY output bytes
//   server→client  0x02  PTY exit (4-byte LE exit code)
//   client→server  0x03  Input bytes
//   client→server  0x04  Resize (2-byte cols LE + 2-byte rows LE)

type DataHandler = (bytes: Uint8Array) => void;
type ExitHandler = (code: number) => void;

export class PtyWsBridge {
  private ws: WebSocket | null = null;
  private dataHandlers: DataHandler[] = [];
  private exitHandlers: ExitHandler[] = [];

  onData(cb: DataHandler): void { this.dataHandlers.push(cb); }
  onExit(cb: ExitHandler): void { this.exitHandlers.push(cb); }

  connect(
    threadId: string,
    cols: number,
    rows: number,
    projectRoot?: string,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const params = new URLSearchParams({
        threadId,
        cols: String(cols),
        rows: String(rows),
        ...(projectRoot ? { projectRoot } : {}),
      });
      const url = `${proto}//${window.location.host}/api/pty-ws?${params}`;
      const ws = new WebSocket(url);
      ws.binaryType = "arraybuffer";
      this.ws = ws;

      ws.addEventListener("open", () => resolve());
      ws.addEventListener("error", (e) => reject(e));

      ws.addEventListener("message", (e) => {
        const buf = new Uint8Array(e.data as ArrayBuffer);
        const tag = buf[0];
        if (tag === 0x01) {
          const payload = buf.slice(1);
          for (const cb of this.dataHandlers) cb(payload);
        } else if (tag === 0x02) {
          const view = new DataView((e.data as ArrayBuffer), 1);
          const code = view.getInt32(0, true /* little-endian */);
          for (const cb of this.exitHandlers) cb(code);
        }
      });

      ws.addEventListener("close", () => {
        this.ws = null;
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
    if (this.ws) {
      this.ws.close(1000, "disposed");
      this.ws = null;
    }
  }
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
pnpm tsc --noEmit 2>&1 | tail -5
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/pty-ws-bridge.ts
git commit -m "feat(terminal): PtyWsBridge client-side WebSocket PTY bridge"
```

---

### Task 4: Update `bottom-terminal.tsx` — branch on platform

**Files:**
- Modify: `src/components/bottom-terminal.tsx`

- [ ] **Step 1: Add import for PtyWsBridge at the top**

```ts
import { PtyWsBridge } from "@/lib/pty-ws-bridge";
```

- [ ] **Step 2: Update the `unavailable` logic**

Replace:
```ts
useEffect(() => {
  if (platform === "ios" || platform === "android" || platform === "browser") {
    setUnavailable(true);
  }
}, [platform]);
```
With:
```ts
useEffect(() => {
  // iOS/Android Tauri: no shell available in the mobile sandbox
  if (platform === "ios" || platform === "android") {
    setUnavailable(true);
  }
  // "browser" (non-Tauri): terminal available via WS bridge — do NOT set unavailable
}, [platform]);
```

- [ ] **Step 3: Add a `wsBridgeRef` alongside the existing refs**

After `const termRef = ...`, add:
```ts
const wsBridgeRef = useRef<PtyWsBridge | null>(null);
```

- [ ] **Step 4: Add a second `useEffect` for the WS bridge path**

Add this after the existing Tauri `useEffect` (the one that has `if (platform !== "desktop") return`):

```ts
// WS bridge path — runs in browser (non-Tauri) context.
useEffect(() => {
  const wrap = wrapRef.current;
  if (!wrap) return;
  if (platform !== "browser") return;

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
    try { fit.fit(); } catch { /* DOM not ready */ }

    const bridge = new PtyWsBridge();
    wsBridgeRef.current = bridge;

    bridge.onData((bytes) => {
      term.write(bytes);
      pushToMirror(bytes);
    });

    bridge.onExit((code) => {
      const exitMsg = `\r\n\x1b[2m[exit ${code}]\x1b[0m\r\n`;
      term.write(exitMsg);
      pushToMirror(new TextEncoder().encode(exitMsg));
    });

    try {
      await bridge.connect(threadId, term.cols, term.rows, projectRootRef.current);
    } catch (err) {
      const failMsg = `\r\n\x1b[31mTerminal connection failed: ${String(err)}\x1b[0m\r\n`;
      term.write(failMsg);
      pushToMirror(new TextEncoder().encode(failMsg));
      return;
    }

    if (disposed) { bridge.dispose(); return; }

    const onDataDispose = term.onData((data) => {
      bridge.write(new TextEncoder().encode(data));
    });

    const doResize = () => {
      try {
        fit.fit();
        bridge.resize(term.cols, term.rows);
      } catch { /* harmless */ }
    };

    const ro = new ResizeObserver(doResize);
    ro.observe(wrap);

    fitRef.current = () => { doResize(); term.focus(); };
    term.focus();

    cleanup = () => {
      ro.disconnect();
      onDataDispose.dispose();
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      pendingMirrorRef.current = "";
      termRef.current = null;
      bridge.dispose();
      wsBridgeRef.current = null;
      term.dispose();
    };

    if (disposed) cleanup();
  })();

  return () => {
    disposed = true;
    cleanup?.();
  };
}, [threadId, platform]);
```

- [ ] **Step 5: Update the `unavailable` render**

Replace:
```tsx
if (unavailable) {
  return (
    <div className="flex h-full items-center justify-center text-[11px] text-[var(--text-muted)]">
      Terminal is only available inside the CovenCave desktop app.
    </div>
  );
}
```
With:
```tsx
if (unavailable) {
  return (
    <div className="flex h-full items-center justify-center text-[11px] text-[var(--text-muted)]">
      Terminal is not available on this device.
    </div>
  );
}
```

- [ ] **Step 6: Verify TypeScript**

```bash
pnpm tsc --noEmit 2>&1 | tail -10
```
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/bottom-terminal.tsx src/lib/pty-ws-bridge.ts
git commit -m "feat(terminal): add WS bridge path to bottom-terminal — works in browser + Tauri"
```

---

### Task 5: Add smoke test for pty-ws-bridge

**Files:**
- Create: `src/lib/pty-ws-bridge.test.ts`

- [ ] **Step 1: Create the test**

```ts
// @ts-nocheck
// Source-read smoke test for PtyWsBridge.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./pty-ws-bridge.ts", import.meta.url), "utf8");

assert.match(src, /class PtyWsBridge/, "PtyWsBridge class exists");
assert.match(src, /0x01/, "handles data tag 0x01");
assert.match(src, /0x02/, "handles exit tag 0x02");
assert.match(src, /0x03/, "sends input tag 0x03");
assert.match(src, /0x04/, "sends resize tag 0x04");
assert.match(src, /binaryType.*arraybuffer/, "sets binaryType to arraybuffer");
assert.match(src, /dispose\(\)/, "has dispose method");

console.log("pty-ws-bridge.test.ts: ok");
```

- [ ] **Step 2: Update `package.json` test:api script to include the new test**

Find the `test:api` script and append:
```
&& node --experimental-strip-types src/lib/pty-ws-bridge.test.ts
```

- [ ] **Step 3: Run tests**

```bash
pnpm test:api 2>&1 | grep -E "ok|passed|failed|pty-ws"
```
Expected: `pty-ws-bridge.test.ts: ok`

- [ ] **Step 4: Commit**

```bash
git add src/lib/pty-ws-bridge.test.ts package.json
git commit -m "test(terminal): smoke test for PtyWsBridge"
```

---

### Task 6: Final verification + push

- [ ] **Step 1: Run all tests**

```bash
pnpm test:api 2>&1 | tail -10
```
Expected: all passing.

- [ ] **Step 2: Full TypeScript check**

```bash
pnpm tsc --noEmit 2>&1 | tail -5
```
Expected: no errors.

- [ ] **Step 3: Build check**

```bash
pnpm next build 2>&1 | tail -8
```
Expected: build completes without errors.

- [ ] **Step 4: Smoke test dev server starts with custom server**

```bash
timeout 10 node --experimental-strip-types server.ts 2>&1 | head -5
```
Expected: `> Ready on http://0.0.0.0:3000` (or similar, then timeout kills it).

- [ ] **Step 5: Push**

```bash
git push
```

---

## Self-Review Notes

- ✅ Tauri IPC path in `bottom-terminal.tsx` is completely unchanged
- ✅ WS bridge only activates when `platform === "browser"`
- ✅ iOS/Android still shows unavailable message (no shell in mobile sandbox)
- ✅ Auth check in `server.ts` matches `COVEN_CAVE_ACCESS_TOKEN` cookie logic from `proxy.ts`
- ✅ Shell/args/env hardcoded server-side — no renderer-supplied process authority
- ✅ `projectRoot` validated with `statSync` before use as cwd
- ✅ Protocol tags documented and consistent between client and server
- ✅ `serverExternalPackages: ["node-pty"]` prevents webpack from trying to bundle native addon
- ✅ `node-pty` added to `outputFileTracingIncludes` for standalone build
