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

The script starts Cave on loopback, publishes it through Tailscale Serve, creates a signed invite, stores it in a private local state directory, and copies the invite URL to the Mac clipboard. The raw invite URL is not printed by default so chat logs and terminal captures do not accidentally leak the Tailscale hostname or token.

Default state lives under:

```bash
${XDG_STATE_HOME:-~/.local/state}/coven-cave/mobile-tailscale-3000/
```

Useful commands:

```bash
pnpm mobile:tailscale          # start the persistent loopback server and create an invite
pnpm mobile:tailscale:invite   # create a fresh invite for the running server
pnpm mobile:tailscale:status   # show process/state info with host/token redacted
pnpm mobile:tailscale:stop     # stop the dev server and reset Tailscale Serve
```

For a local simulator/emulator workflow, use the checked-in wrappers:

```bash
pnpm mobile:ios:sim
pnpm mobile:android:setup   # one-time SDK, AVD, and Tauri project setup
pnpm mobile:android:start
pnpm mobile:android:dev
```

The Android wrapper uses `Coven_Cave_API_35` by default, selects the system
image ABI for Apple Silicon or Intel, chooses a free development port in
`3000..3010`, and keeps `src-tauri/gen/android/` as ignored local build output.

Set `PRINT_URL=1` only when you intentionally want the raw invite printed in a trusted local terminal:

```bash
PRINT_URL=1 pnpm mobile:tailscale:invite
```

The app stores the invite in an HTTP-only cookie after the first successful request and removes it from the visible URL.

In the packaged desktop app, click **Open on phone** in the top bar to create the same kind of invite as a QR code. Scan it from a phone signed into the same tailnet.

## Keep the Mac reachable

The packaged macOS app has two explicit, default-off controls under **Settings
→ Phone → Keep this Mac reachable**:

- **Keep Mac awake for phone** holds a macOS power assertion after a phone has
  paired. **Only keep awake on power** is on by default, so battery power keeps
  the Mac's normal sleep policy. Turning either setting off releases the
  assertion.
- **Background availability** installs a per-user LaunchAgent. The GUI owns the
  loopback server while its main window is open; after that window closes, the
  LaunchAgent starts the bundled `server.mjs` without opening the app. Disabling
  the option unloads and removes the LaunchAgent.

Both the GUI server and the LaunchAgent server remain bound to
`127.0.0.1`. Whenever either server chooses a different port, it repoints
Tailscale Serve at that exact loopback backend. Existing signed phone tokens
continue to use the same persisted mobile access secret.

Tailscale cannot wake a sleeping Mac. Its userspace WireGuard daemon sleeps
with the computer, so the phone has no path to deliver a wake packet. Bonjour
sleep proxy is limited to local-network mDNS and does not make wake-on-LAN work
across a tailnet. Use the keep-awake option or an always-on Server Hub when the
phone must remain reachable.

## Connect Cave to a remote Server Hub

Open **Settings → Daemon → Connection**, choose **Server hub**, and use the **Tailnet devices** list to select the machine running the remote Coven daemon. Cave discovers this device and online peers from `tailscale status --json`; it uses the device's `100.x` address when available and fills the standard daemon port, `8787`. The current machine is labelled **This device**. You can still enter a MagicDNS name or another private HTTP URL manually.

Before Cave saves a Server Hub URL, it checks `/api/v1/health` with a short timeout and shows the result and latency beside the field. A healthy target saves normally. An unreachable, unauthorized, or unhealthy target remains unsaved until you explicitly choose **Save anyway**. The Status group then distinguishes a connected hub and its last successful check from a configured-but-unreachable hub.

When Phone pairing has already resolved this machine's tailnet address, expand **Manual setup** and choose **Use this device as hub** to carry that address into the Server Hub field. Cave still runs the reachability check before saving it.

## Remote Agent Handoff

When asking an agent to run the mobile version remotely, the safest repeatable flow is:

```bash
pnpm mobile:tailscale:status
pnpm mobile:tailscale
pnpm mobile:tailscale:invite
```

The agent should verify that the invite redirects, stores the cookie, and loads the app shell before reporting success. It should not paste the raw invite into chat by default. If a fresh invite expires while you are away from the laptop, ask the agent to run `pnpm mobile:tailscale:invite`; the command refreshes the invite without restarting the dev server.

Do not open the Serve URL without the invite query. When `COVEN_CAVE_ACCESS_TOKEN` is set, CovenCave rejects requests until a valid signed `coven_access_token` invite is supplied by query, cookie, bearer header, or the equivalent internal request path. A loopback-looking `Host` header is not treated as proof of a local connection because remote clients can spoof it.

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
pnpm mobile:tailscale:stop
```

## Troubleshooting

If the phone cannot open the URL:

```bash
tailscale status --self
pnpm mobile:tailscale:status
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
