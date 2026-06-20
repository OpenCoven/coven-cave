# Coven Cave — Native iOS Rebuild Plan

> Status: **DRAFT / Phase 0 (recon + design)** — started 2026-06-20.
> Owner: this is a multi-phase arc. Each phase ships independently and is verifiable on its own.

## Goal (verbatim intent)

Rebuild the iOS app from the ground up as a **genuinely native iOS experience** — not a
WKWebView preview of the Next.js web app. Drop the per-launch access **token** entirely and
trust **any device on the same Tailscale network** as the locally-hosted desktop app. Ship in
**phases**, starting with a **solid, fully-functional MVP**: a seamless chat experience with
**one familiar or several** (select + group), feeling like **Telegram × iMessage × ChatGPT**.

## Why rebuild (current state)

The shipping iOS app is a **Tauri v2 WKWebView** that loads the Next.js frontend over a dev URL.
Documented failure history (see memory `project_ios_sim_blank_render_2026-06-15`):

- The sim renders blank because the webview points at a flaky **Turbopack `next dev`** server and
  the access **token is passed in the URL query**, which mangles `/_next/static/...` chunk URLs
  (every JS chunk 404s → React never hydrates → blank skeleton).
- The app **bundles no frontend** — it depends on a reachable dev server over loopback/Tailscale.
- iOS Local-Network permission resets on reinstall; loopback gets blocked; fallback is a blank stub.

Net: the current architecture is fragile end-to-end (dev-server reachability, token-in-URL,
webview caching, local-network perms). It is a web preview, not a native app. The user's call to
go native is well-founded.

**Toolchain available locally:** Xcode 26.5, Swift 6.3.2, iPhone 16 Pro simulator. Full native
build/run/verify is possible on this machine.

## Architecture decision

Build a **native SwiftUI app** (iOS 17+/26 SDK) that talks to the desktop over HTTP + streaming
(SSE/WebSocket) across the **Tailscale tailnet**. The desktop app (Next.js `server.ts`/`server.mjs`
+ local `coven` daemon) stays the source of truth — familiars, sessions, message history, and
chat streaming all live there. The iOS app is a **first-class client**, not a renderer.

```
┌─────────────────────────┐         Tailscale tailnet (100.x / MagicDNS)        ┌────────────────────────────┐
│  iPhone (SwiftUI app)   │  ──────────────  HTTP + SSE/WS  ───────────────▶   │  Mac desktop (host)        │
│  • Familiars list/group │                                                     │  Next.js server.ts (:3000) │
│  • Chat (native bubbles)│  ◀─────────  streamed assistant tokens  ──────────  │  + coven daemon            │
│  • Local cache (SwiftData)                                                     │  ~/.coven state on disk    │
└─────────────────────────┘                                                     └────────────────────────────┘
```

Rejected: Tauri iOS (still a webview → violates "not a preview"). Rejected: React Native (keeps a
JS bridge, no real win over the existing web app; the point is native UIKit/SwiftUI feel).

### Trust model — Tailscale-only, no token

Replace the per-launch `COVEN_CAVE_ACCESS_TOKEN` / `?covenCaveToken=` gate with **tailnet
membership = trust**. Concretely, on the desktop server:

1. **Bind the mobile listener to the Tailscale interface** (the host's `100.x.x.x` address /
   MagicDNS name), not a public `0.0.0.0`. Loopback stays open for the desktop webview.
2. **Accept requests whose peer source IP is in the Tailscale CGNAT range** (`100.64.0.0/10`) or
   loopback; reject others. No token in URL, header, or query.
3. This holds across **all transports** — HTTP, SSE, WebSocket — since the prior token gate was
   enforced per-transport (see `feedback_access_gate_entry_points`). Each transport must apply the
   same source-IP check.

Rationale: Tailscale is already a private, authenticated, encrypted mesh; being on the tailnet is
itself the auth boundary the user wants. This removes the token-in-URL chunk-mangling failure mode
entirely and makes "open the app, it just connects" possible.

> Security note to confirm in implementation: trusting source IP requires the server to not be
> reachable off-tailnet on that listener. We bind to the Tailscale IP specifically; we do **not**
> open `0.0.0.0`. Spoofing a `100.x` source across the internet to a tailnet-bound socket is not
> reachable.

## API contract (confirmed — Phase 0 recon)

The native networking layer (`CaveClient` in Swift) targets these. Base URL is the
host's Tailscale address; no auth header (tailnet is the trust boundary).

- **List familiars:** `GET /api/familiars` → `{ ok, familiars: [...] }`. Each familiar:
  `id`, `display_name`, `role`, `description`, `color`, `status`, `harness`, `model`,
  `icon` (Phosphor name), `avatarUrl` (`/api/familiars/{id}/avatar?v=<mtime>`).
- **List sessions:** `GET /api/sessions/list[?includeArchived=1]` → `{ ok, sessions: SessionRow[] }`
  (`id`, `title`, `harness`, `status`, `familiarId`, `created_at`, `updated_at`).
- **Load history:** `GET /api/chat/conversation/{sessionId}` → `{ ok, conversation: { turns: ChatTurn[] } }`.
- **Send + stream:** `POST /api/chat/send` (SSE). Body `{ familiarId, prompt, sessionId? }`.
  Stream events (`data:` JSON, discriminated by `kind`): `session` (stable sessionId),
  `user`, `assistant_chunk` (streamed text), `progress`, `tool_use`, `done`, `error`.
- **Grouping:** **not** a server concept — each conversation is single-`familiarId`. The MVP
  implements groups **client-side**: one server session per familiar, fanned out in parallel,
  attributed per-familiar in one UI thread (`ChatThread` in the app). Promote to a server
  concept later only if needed.

### What shipped in this scaffold (`apps/ios/CovenCave/`)

A buildable, runnable SwiftUI app (iOS 17+, XcodeGen project) covering the Phase 1 UI + client:
`CaveClient` (REST + `AsyncThrowingStream` SSE parser), `CaveConnection` (host normalisation,
`.ts.net`→HTTPS / IP→HTTP:3000, no token), `AppModel` + `ChatThread` (single + group fan-out,
on-disk thread persistence), and the views: connection, chats home (roster of threads),
new-chat/group picker, chat thread (iMessage bubbles + per-familiar attribution + streaming),
settings. **Verified on the iPhone 16 Pro simulator** against a mock implementing the contract
above: native render (no webview), familiars loaded tokenlessly, group thread with attributed
replies.

### Phase 1b — tokenless server, DONE (with a correction)
`pnpm mobile:tailscale:app` starts the loopback Next server with no token (no
`COVEN_CAVE_ACCESS_TOKEN`/`COVEN_CAVE_AUTH_TOKEN`, not bundled) and `tailscale serve`s it.

**Correction (verified against a real tailnet, 2026-06-20):** an earlier draft claimed this
needed *no* proxy change because Serve forwards `Host: 127.0.0.1`. That is **false** for current
Tailscale — Serve forwards the request's `<host>.ts.net` Host, so `isAllowedApiHost` returned
**403 "forbidden host"** for every tokenless tailnet request. The fix: the app mode sets
`COVEN_CAVE_TAILNET_TRUST=1`, which `proxy.ts` feeds into the host gate as
`isAllowedApiHost(requestHost, mobileAccessAuthenticated || tailnetTrusted)`. The CSRF
Origin/Referer gate still blocks cross-site browser requests; a native client sends no Origin and
passes. The packaged desktop app does **not** set the flag, so its gate is unchanged. Pinned by
`middleware.test.ts` + `proxy-behavior.test.ts`.

End-to-end verified: the iOS app on the simulator loaded the real 11 familiars (incl. avatar
images) and a real `claude` harness session was driven via `POST /api/chat/send`, all tokenless
over `https://<host>.ts.net:<port>`.

### Remaining (next, separate PRs)
- **Live streaming send in-app** end-to-end against a real desktop (the SSE client is built and
  the path is proven via curl; needs in-app verification, blocked locally by lack of tap tooling).
- History load on thread open (client method exists; wire into `ChatView.onAppear`).

## Phased rollout

### Phase 0 — Recon & design _(in progress)_
- Audit current Tauri/iOS setup, mobile scripts, token gate. ✅ (this doc + agents)
- Map backend chat/familiar/session API contract. ⏳ (agent)
- Decide repo location for the Swift app: **`apps/ios/CovenCave/`** (Xcode project in-repo;
  does not enter the web CI checks — tracked/built separately).

### Phase 1 — MVP: seamless single + multi-familiar chat
The "fully-functional MVP" bar. Native SwiftUI, no token, Tailscale connect.
1. **Connection:** discover/enter the host's MagicDNS name or Tailscale IP; persist it; health-check.
   No token. Graceful "can't reach host / not on tailnet" state.
2. **Familiars list:** fetch + render familiars with avatars (Telegram-style roster).
3. **1:1 chat:** open a familiar → native message thread (iMessage-style bubbles), composer,
   send, **streamed** assistant reply (ChatGPT-style token streaming), markdown rendering.
4. **Session continuity:** load prior history for a familiar; resume; new chat.
5. **Multi-familiar select + group:** pick ≥2 familiars → a named group thread; sending fans the
   prompt to each and shows replies attributed per-familiar (Telegram group feel).
6. **Polish:** dark theme parity, haptics, pull-to-refresh, keyboard handling, empty/error states.

**Phase 1 done =** install on a real iPhone over Tailscale, no token, chat with one familiar and
with a group, streamed replies, survives backgrounding. Verified on simulator + (if available) device.

### Phase 2 — Depth
- Push-style local notifications for completed agent runs.
- Attachments / images in chat. Voice input.
- Workflows / board / journal read surfaces (native, selective — not a full web port).
- Offline cache (SwiftData) + optimistic send + reconnect/replay of in-flight streams.

### Phase 3 — Distribution & hardening
- App icon, launch screen, TestFlight pipeline.
- Background reconnect, tailnet change handling, multiple-host switching.
- Settings: appearance, host management, diagnostics.

## Non-goals (MVP)
- Porting every web surface to native. The web app remains for desktop; iOS gets the chat-first
  native experience and grows selectively.
- Public/internet exposure. Tailnet-only by design.
- Keeping the Tauri iOS webview path. It is retired for the mobile experience (desktop Tauri stays).

## Open questions / defaults taken
- **Networking target:** prefer the Next.js `/api` layer (stable, already abstracts the daemon)
  over hitting the daemon directly — confirm with recon.
- **Grouping persistence:** store group definitions client-side first (SwiftData); promote to a
  server concept later if needed.
- **CI:** Swift app builds outside the web `Frontend build`/`Rust check`/`E2E` checks; we add a
  lightweight `xcodebuild` build step later (Phase 3), not a `main` blocker for MVP.
