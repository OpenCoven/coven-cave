# Mobile Access Over Tailscale

This runs CovenCave's browser surface on your development machine and exposes it privately to your phone through Tailscale Serve.

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

## Manual Equivalent

```bash
pnpm dev -- -H 127.0.0.1 -p 3000
tailscale serve --bg 3000
tailscale serve status
```

## Fallback Without Serve

```bash
pnpm dev -- -H 0.0.0.0 -p 3000
tailscale ip -4
```

Open:

```text
http://<tailscale-ip>:3000
```

Use this only when Serve is unavailable. Prefer Serve because it keeps the app private to the tailnet and gives HTTPS.

## Expected Mobile Behavior

- Chat, Inbox, Board, Library, Familiars, and Settings should load.
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
