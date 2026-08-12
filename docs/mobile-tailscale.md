# Mobile Access Over Tailscale

This runs CovenCave's browser surface on your development machine and exposes it privately to your phone through Tailscale Serve with a short-lived mobile invite.

For a device you own, you can skip the invite entirely — see
[Tokenless access by tailnet device identity](#tokenless-access-by-tailnet-device-identity).

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
pnpm mobile:ios:sim   # xcodegen generate + xcodebuild the native app onto the iOS simulator
```

The iOS wrapper drives the native Swift app under `apps/ios/CovenCave` (Android
is not a supported target).

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

> ⚠️ **The access-token requirement was removed at the owner's direction
> (`cave-f4emr`).** `COVEN_CAVE_ACCESS_TOKEN` no longer gates anything: the
> proxy/middleware no longer serves an access page, no longer 401s a request
> for missing a credential, and no longer performs the access-gate
> cookie/query-token exchange. Whatever can reach the Serve URL reaches the
> app.
>
> The pairing machinery below is **unchanged** — `/api/mobile-handoff` and
> `/api/mobile-token/refresh` still mint signed invite URLs, still set the
> access cookie, and the phone still carries a token. What changed is that
> nothing verifies any of it, so an invite is now a convenience link (it
> carries the host) rather than a credential. **Publishing a Serve route
> therefore publishes the whole app to everything on the tailnet.** If you want
> a control back, the one that survives is the passkey-presence requirement
> (`COVEN_CAVE_PASSKEY_REQUIRED=1`, see below), which binds remote `/api/*`
> access to a WebAuthn assertion on an allowlisted tailnet device.

Every `/api/*` request still has to satisfy loopback/same-origin/referer/content-type checks — those guards apply in plain browser dev too, not just in bundled mode. Remote (Serve-forwarded) ingress satisfies the host gate on the strength of being classified remote rather than by presenting anything; mismatched origins still hit a 403 before any handler runs.

Next.js dev internals are separately origin-checked. `next.config.ts` allowlists `**.ts.net` for development so Tailscale Serve can load HMR/runtime resources while the actual server remains bound to loopback.

## Manual Equivalent

Keep the Next.js server bound to loopback so only Tailscale Serve can proxy it. In one terminal, start Cave:

```bash
pnpm exec next dev -H 127.0.0.1 -p 3000
```

`COVEN_CAVE_ACCESS_TOKEN` used to belong here and no longer does: setting it
gates nothing (`cave-f4emr`). It is still read by the pairing flow to sign
invite URLs, so the Tauri app keeps providing one, but it is not a credential
any request is checked against.

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

## Tokenless access by tailnet device identity

The invite flow authorizes a phone with a **shared bearer secret** that you copy,
deep-link, or scan. It works, but the secret is transferable: anything that
learns it is you. For a device you own, you can authorize the *device itself*
instead and stop minting invites.

Find the stable node ID of the devices you want to admit:

```bash
node scripts/tailnet-allowlist.mjs                  # list every visible device
node scripts/tailnet-allowlist.mjs my-phone        # emit the env line for one
```

Then start the server with that allowlist:

```bash
COVEN_CAVE_TAILNET_ALLOWED_NODES=nEXAMPLE0000011CNTRL pnpm dev
```

That device now reaches the app over Tailscale Serve with no token at all. Every
other tailnet node is refused, so this is *not* the old "anyone on the tailnet"
behavior — tailnet membership alone has never been authorization here, and still
isn't.

**How it is enforced.** `server.ts` is the only component that sees the raw TCP
socket. It resolves the forwarded tailnet address against a `tailscale status`
poll (refreshed every 30s), checks the resulting stable node ID against the
allowlist, and stamps a header signed with a per-boot secret that never leaves
the process. `proxy.ts` verifies that stamp in constant time. Any client-supplied
copy of the header is deleted before Next ever sees the request, so the stamp
cannot be forged from outside.

**Why the forwarded address is trusted here.** The TCP peer must already be
loopback, because Tailscale Serve terminates TLS and forwards to `127.0.0.1`. A
local process able to forge the forwarded-for header could instead connect
straight to loopback, which grants strictly *more* authority. So reading it adds
no new exposure while upgrading remote auth from a shared secret to WireGuard
device identity.

**Fail-closed behavior.** No allowlist means no tailnet access. An unreadable
`tailscale status` clears the allowlist rather than leaving stale entries, so a
revoked device loses access instead of coasting on a cached mapping. Revoking a
device takes at most one refresh interval.

**Notes and limits.**

- Stable node IDs are used deliberately: hostnames and tailnet IPs both move,
  node IDs survive renames, IP changes, and re-authentication.
- Local-only surfaces (Codex automation runs) stay off this path exactly as they
  stay off the invite path — a forwarded Host cannot prove a loopback origin.
- This authorizes a **device**, not a person. Anyone holding an unlocked
  allowlisted phone is that device. The next section closes that gap.

## Proving the human, not just the device (passkeys)

Tailnet identity answers *which device*. It cannot answer *which human* — an
unlocked allowlisted phone in someone else's hand is still the allowlisted
phone.

The app has had a biometric lock for a while, but it was a SwiftUI screen gated
on a local preference: nothing about it reached the server, so a client with
biometrics switched off was indistinguishable from one that had just passed Face
ID. It was a UI lock, not an authorization signal.

A passkey fixes that, because the proof is a signature rather than a claim. The
private key lives in the Secure Enclave with user verification required, so it
**cannot sign at all** without a successful biometric check. A verifying
signature therefore *is* the biometric check.

### Enrolling

Open **Settings → Phone → Passkey** on the device you want to enroll and choose
**Add a passkey**. Enrollment is reachable only from a peer the server has
already authenticated at the socket layer — an allowlisted tailnet device, or a
direct loopback connection on the machine itself. The passkey is a *second*
factor; it does not replace the first.

### Requiring it

```bash
COVEN_CAVE_PASSKEY_REQUIRED=1 pnpm dev
```

Off by default, deliberately: arming it before anything is enrolled would lock
the phone out of the very ceremony that would satisfy it. With it on, every
remote `/api` request must carry a presence proof no older than 15 minutes.

Three exemptions, each for a reason:

- **Page navigations.** The surface that runs the WebAuthn ceremony has to
  render, or the gate is a wall with no door.
- **`/api/passkey/*`.** Obtaining presence cannot itself require presence.
- **Local ingress.** A direct loopback peer is someone sitting at the machine.

That second exemption would otherwise be the bypass — an attacker holding a
stolen allowlisted device could enroll *their own* credential and satisfy the
gate with it. So the sensitive endpoints in that family police themselves:
enrolling an **additional** credential requires the existing one, and so does
revoking any. Only bootstrapping the very first is exempt.

Note that a **mobile invite token can never satisfy this gate**. The presence
proof is bound to a device identity and a shared bearer secret does not carry
one. Arming the requirement means remote access is by tailnet device identity
plus biometrics, full stop.

### What is and is not verified

Verified: the signature, the server-minted single-use challenge, the origin and
RP ID, the user-verification flag, the signature counter when the authenticator
implements one, and that the credential is bound to the presenting tailnet node.

**Not** verified: the attestation statement. Checking it means walking a
certificate chain to Apple's root, which proves the authenticator *model* — that
the key really is in a Secure Enclave rather than a software authenticator that
can simply assert the UV flag. The gap is narrow, because registration is
already reachable only from an allowlisted device, but it is real and it is
filed as `cave-01v4u`. The stored credential records the attestation format so
the gap is visible in state rather than implied.

Presence tokens are keyed by a secret minted per boot, so restarting the server
invalidates every outstanding proof. That is intended: "the process that saw
your biometric proof is gone" is a good reason to ask for it again.

## Troubleshooting

If the phone cannot open the URL:

```bash
tailscale status --self
pnpm mobile:tailscale:status
curl -I http://127.0.0.1:3000
```

If the app loads but actions fail, verify the host machine has the Coven daemon/runtime available. The phone is only a browser; the host machine still performs local work.

## Native iOS App

The mobile experience is a **native Swift/SwiftUI app** at [`apps/ios/CovenCave`](../apps/ios/CovenCave), not a Tauri webview. (The Tauri iOS/Android shell was retired — see [`ios-native-rebuild.md`](ios-native-rebuild.md).) It ships exactly the same daemon-over-Tailscale model described above: there is **no bundled local Node sidecar** on mobile. The app is a native client that talks to a Cave daemon over the tailnet, pointed at either:

- The Tailscale Serve URL of your laptop while you're on the same tailnet, OR
- A long-lived `tailscale serve` on a home server that the phone always reaches over the tailnet.

Either way the daemon lives on a desktop, not the phone.

### Pairing the app to a daemon

Expose the daemon over Tailscale Serve and print a pairing URL for the app:

```bash
pnpm mobile:tailscale:app      # tailscale serve + a QR/pairing URL carrying the access token
```

Scan or paste that URL in the app. The `coven_access_token` query param it carries is no longer checked (`cave-f4emr`) — the URL's value is now the host it points at, not the credential it carries. Serve exposes every `/api` route to anything on the tailnet.

### Building / running the app

```bash
pnpm mobile:ios:sim            # xcodegen generate + xcodebuild against the iOS simulator
```

The Xcode project is generated by `xcodegen` from `apps/ios/CovenCave/project.yml` (the `.xcodeproj` is gitignored). Production builds ship through TestFlight. Because the app is native, there is no PWA service worker and no bundled sidecar to reason about.
