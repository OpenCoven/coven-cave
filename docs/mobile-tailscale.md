# Mobile Access Over Tailscale

This runs CovenCave's browser surface on your development machine and exposes it privately to your phone through Tailscale Serve with a short-lived mobile invite.

## Requirements

- Tailscale installed and signed in on the development machine.
- Tailscale installed and signed in on the phone.
- Both devices are in the same tailnet.
- MagicDNS and HTTPS enabled in the tailnet if you want the stable HTTPS Serve URL.
- `pnpm install` has been run in this checkout.
- The local Coven daemon/runtime setup is healthy on the development machine.

## Start

```bash
pnpm mobile:tailscale
```

Open the HTTPS URL printed by:

```bash
pnpm mobile:tailscale
```

The script starts Cave on loopback, publishes it through Tailscale Serve, then prints a ready-to-open invite URL containing a signed `coven_access_token`. The app stores the invite in an HTTP-only cookie after the first successful request and removes it from the visible URL.

In the packaged desktop app, click **Open on phone** in the top bar to create the same kind of invite as a QR code. Scan it from a phone signed into the same tailnet.

Do not open the Serve URL without the invite query. When `COVEN_CAVE_ACCESS_TOKEN` is set, CovenCave rejects requests until a valid invite is supplied by query, cookie, bearer header, or the equivalent internal request path.

Independent of the mobile token, every `/api/*` request also has to satisfy loopback/same-origin/referer/content-type checks — those guards apply in plain browser dev too, not just in bundled mode. A valid mobile token lets Tailscale Serve satisfy the host/origin/referer gates while it proxies to the loopback dev server; anything else (LAN scanners, accidental `-H 0.0.0.0`, mismatched origins without the token) hits a 403 before any handler runs.

Next.js dev internals are separately origin-checked. `next.config.ts` allowlists `**.ts.net` for development so Tailscale Serve can load HMR/runtime resources while the actual server remains bound to loopback.

## Manual Equivalent

Use a strong random token and keep the Next.js server bound to loopback so only Tailscale Serve can proxy it. In one terminal, start Cave:

```bash
TOKEN=$(node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))")
echo "$TOKEN"
COVEN_CAVE_ACCESS_TOKEN="$TOKEN" pnpm exec next dev -H 127.0.0.1 -p 3000
```

In another terminal, publish the loopback server:

```bash
tailscale serve --bg http://127.0.0.1:3000
tailscale serve status
```

Prefer the generated invite from `pnpm mobile:tailscale` or **Open on phone**. The proxy still accepts the raw per-run token for manual debugging, but release flows use signed expiring invites.

## No `0.0.0.0` Fallback

Do not run CovenCave with `-H 0.0.0.0` for mobile access. Binding to all interfaces exposes the unauthenticated local development surface to the LAN as well as the tailnet if `COVEN_CAVE_ACCESS_TOKEN` is missing or misconfigured. If Tailscale Serve is unavailable, fix Serve or use a different authenticated tunnel that can reach the loopback-bound server.

## Expected Mobile Behavior

- Home, Chat, Board, Calendar, Inbox, Library, and Settings should load.
- The native Tauri terminal does not run in a mobile browser.
- Native desktop notifications do not run in a mobile browser.
- Browser view uses the web fallback path, not the desktop webview.

## Stop

```bash
tailscale serve reset
pkill -f "next dev.*3000" || true
```

## Troubleshooting

If the phone cannot open the URL:

```bash
tailscale status --self
tailscale serve status
curl -I http://127.0.0.1:3000
```

If the app loads but actions fail, verify the host machine has the Coven daemon/runtime available. The phone is only a browser; the host machine still performs local work.

## Native Tauri Mobile Shell

A Tauri iOS / Android binary (built via `pnpm tauri ios build` / `pnpm tauri android build`) ships exactly the same daemon-over-Tailscale model — there is **no bundled local Node sidecar** on mobile. iOS sandbox rules forbid spawning child processes, and the standalone Next.js server + node_modules tree would balloon the IPA past 100MB. The native shell is a thin webview that points at:

- The Tailscale Serve URL of your laptop while you're on the same tailnet, OR
- A long-lived `tailscale serve` on a home server that the phone always reaches over the tailnet.

Either way the daemon lives on a desktop, not the phone. The phone only renders.

### What changes in the native shell vs. mobile-web

The native shell wraps the same Next.js UI. The only differences:

- Push notifications: `tauri-plugin-notification` works on iOS and Android. The first call to `nativeNotify()` triggers the system permission prompt; thereafter the shell can fire local notifications even when the webview isn't focused.
- "Add to Home Screen" isn't a thing because the shell ships as a regular app icon installed from TestFlight / Play.
- The PWA service worker (`/sw.js`) is **not** registered inside Tauri. The desktop and mobile shells both rely on Tauri's webview cache, and an SW would intercept loopback requests and cache stale IPC responses (`PwaRegister` skips when `__TAURI_INTERNALS__` is present).
- The bottom terminal and the embedded `BrowserPane` surfaces are unavailable, same as mobile-web — the `pty_*` / `browser_*` Rust commands are `cfg(desktop)`-gated and not registered on mobile-Tauri. Both surfaces detect this via `useTauriPlatform()` and render their "Terminal is only available inside the CovenCave desktop app" / iframe-fallback placeholder.

### One-time scaffolding

```bash
pnpm tauri ios init      # generates src-tauri/gen/apple/
pnpm tauri android init  # generates src-tauri/gen/android/
```

Both are interactive (Xcode signing team, Android SDK path). After scaffolding, builds run with `pnpm tauri ios build` / `pnpm tauri android build`. The `prebuild` hook (PWA icon generation) still runs but `sidecar-bundle.sh` short-circuits when `TAURI_PLATFORM` is `ios` or `android`.

### Configuration: which daemon does the phone talk to?

The native shell's `devUrl` (in `src-tauri/tauri.conf.json`) points at the dev server. In production builds, point it at your Tailscale-served daemon URL before running `tauri ios build` — the `$COVEN_CAVE_DAEMON_URL` env var (or whatever your team adopts) should be honoured by a small `build.rs` patch. (Not yet wired; track in a follow-up.)
