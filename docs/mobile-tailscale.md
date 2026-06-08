# Mobile Access Over Tailscale

This runs CovenCave's browser surface on your development machine and exposes it privately to your phone through Tailscale Serve with a per-run access token.

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
tailscale serve status
```

and append the `?coven_access_token=...` value printed by `pnpm mobile:tailscale`. The app stores the token in an HTTP-only cookie after the first successful request.

Do not open the Serve URL without the access query. When `COVEN_CAVE_ACCESS_TOKEN` is set, CovenCave rejects requests until the token is supplied by query, cookie, bearer header, or the equivalent internal request path.

Independent of the mobile token, every `/api/*` request also has to satisfy loopback/same-origin/referer/content-type checks — those guards apply in plain browser dev too, not just in bundled mode. Tailscale Serve passes them because it proxies to the loopback dev server with same-origin headers; anything else (LAN scanners, accidental `-H 0.0.0.0`, mismatched origins) hits a 403 before any handler runs.

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

Open the Serve URL with `?coven_access_token=<printed-token>` appended.

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
