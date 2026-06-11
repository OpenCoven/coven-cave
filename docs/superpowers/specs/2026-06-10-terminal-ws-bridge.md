# Terminal WebSocket PTY Bridge — Design Spec
_2026-06-10 · coven-cave_

## Overview

Add a WebSocket-based PTY bridge so the terminal works in any browser context — mobile web, desktop browser dev server, and the Tauri app. The Tauri path remains as-is (best performance, native IPC). The web path routes through a Next.js custom server that upgrades HTTP requests to WebSocket and pipes them to `node-pty`.

---

## Architecture

```
Browser (xterm.js)
  ↕ WebSocket  ws://host/api/pty-ws?threadId=xxx
Next.js Custom Server (server.ts / server.js)
  ↕ node-pty (spawns shell, full PTY)
  → emits data events back over WS
```

Tauri path is **unchanged** — `useTauriPlatform() === "desktop"` still routes through `pty_start`/`pty_write`/`pty_stop` Tauri commands.

Web path: `platform !== "desktop"` → `WsBridge` class → `WebSocket` to `/api/pty-ws`.

---

## Transport Protocol

Single WebSocket per terminal session. Messages are binary (`Uint8Array`) in both directions with a 1-byte type tag:

| Direction | Tag | Payload |
|-----------|-----|---------|
| server → client | `0x01` | PTY output bytes (raw) |
| server → client | `0x02` | Exit event: 4-byte little-endian exit code |
| client → server | `0x03` | Input bytes to write to PTY |
| client → server | `0x04` | Resize: 2-byte cols LE + 2-byte rows LE |

Query params on connect: `?threadId=<id>&cols=<n>&rows=<n>&projectRoot=<encoded>`

Auth: same `coven_access_token` cookie check used by the REST proxy middleware — only authenticated sessions can open a WS PTY.

---

## Server Side

### `server.ts` (custom Next.js server)

Replace `server.js` / extend with `ws` package:

- On HTTP upgrade to `/api/pty-ws`, parse query params, auth-check cookie, spawn `node-pty` shell session, register in a `Map<threadId, PtyWsSession>`.
- Forward PTY data → WS as `[0x01, ...bytes]`.
- On PTY exit → WS as `[0x02, code_le_4]`, close WS.
- On WS message: tag `0x03` → write bytes to PTY; tag `0x04` → resize.
- On WS close → kill PTY session.
- Same shell/env defaults as Rust: `/bin/zsh -l` on macOS, augmented PATH, `TERM=xterm-256color`, `COLORTERM=truecolor`, `COVENCAVE=1`.

### `package.json`

New deps: `node-pty`, `ws`, `@types/ws` (dev).

### `next.config.ts`

Add `serverExternalPackages: ["node-pty"]` (native addon, must not be bundled by webpack).

---

## Client Side

### `src/lib/pty-ws-bridge.ts` (new)

`PtyWsBridge` class:
- `connect(threadId, cols, rows, projectRoot?)` → opens WS, returns Promise that resolves when WS is open.
- `onData(cb: (bytes: Uint8Array) => void)` — PTY output handler.
- `onExit(cb: (code: number) => void)` — exit handler.
- `write(bytes: Uint8Array)` — send input (tag `0x03`).
- `resize(cols, rows)` — send resize (tag `0x04`).
- `dispose()` — close WS, kill PTY.

WS URL: `ws://` + `window.location.host` + `/api/pty-ws?threadId=...`

### `src/components/bottom-terminal.tsx`

Replace the `unavailable` early-return with a branched setup:

```
if platform === "desktop"  → existing Tauri path (unchanged)
if platform === "browser"  → new PtyWsBridge path
if platform === "ios"/"android" → unavailable (mobile native — no shell)
```

Both paths share the same xterm.js Terminal instance, FitAddon, ResizeObserver, SR mirror, and `active` refit effect. Only the bridge (data in/out/resize/dispose) differs.

---

## Security

- WS upgrade handler checks `coven_access_token` cookie (same check as REST middleware) — unauthenticated upgrades get 401 and closed.
- `projectRoot` validated with `fs.stat` (must exist and be a directory) — rejects path traversal attempts.
- Shell and args are hardcoded server-side (no renderer-supplied command/args/env) — same security principle as the Rust `pty_start`.

---

## Files Touched

| File | Change |
|------|--------|
| `package.json` | Add `node-pty`, `ws`, `@types/ws` |
| `next.config.ts` | Add `serverExternalPackages: ["node-pty"]` |
| `server.ts` | New custom Next.js server with WS upgrade handler |
| `src/lib/pty-ws-bridge.ts` | New WS PTY client bridge |
| `src/components/bottom-terminal.tsx` | Branch on platform: Tauri IPC vs WS bridge |
| `src/app/api/api-contracts.test.ts` | Add `/api/pty-ws` upgrade route contract entry |
| `src/lib/pty-ws-bridge.test.ts` | Source-read smoke test |

---

## Out of Scope

- iOS/Android native shell (no shell available in Tauri mobile sandbox)
- Session persistence across page reloads (shells die on WS close — acceptable for v1)
- Shared/multiplexed terminal sessions
