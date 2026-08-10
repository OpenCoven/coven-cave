# User-bound authentication for loopback callers — design

Status: design for review
Bead: `cave-ruw4z`
Source: final security review of the daemon-connectivity audit (`cave-58eoq`)

## The defect

Cave treats *a connection from this machine* as *a connection from this user*.
Those are not the same claim, and TCP loopback can only support the first.

Verified in the current tree, not inferred:

- `server.ts` calls `isDirectLoopbackRequest(req)`, which checks that
  `req.socket.remoteAddress` is loopback, that no forwarding headers are
  present, and that `Host` is loopback. When all three hold it stamps
  `x-coven-cave-local-peer` with a per-boot secret.
- `proxy.ts` reads that stamp as `trustedLocalPeer` and lets the request past
  the mobile access gate with no credential.
- `server.ts` repeats the exemption on the PTY upgrade path: the 401 is skipped
  entirely when `isDirectLoopbackRequest(req)` holds, even while a token is
  configured.

The per-boot secret is doing real work, but not this work. It stops a *remote*
client from forging the header — the server deletes any client-supplied copy
before Next sees it. It says nothing about *which local user* opened the
socket, because the kernel does not offer that over TCP.

## Consequence

Any process, run by **any OS user on the machine**, that connects to
`127.0.0.1:<port>` with a loopback `Host` and no forwarding headers is
authenticated.

| Surface | What an unprivileged local user gets |
| --- | --- |
| REST (`/api/**`) | Privileged workspace APIs as the Cave user |
| PTY upgrade (`/api/pty-ws`) | **A shell running as the Cave process owner** |

The PTY row is the severe one. It is a local privilege-escalation primitive: a
second account on a shared Mac, a compromised low-privilege service account, or
any sandboxed helper that can open a loopback socket obtains an interactive
shell with the Cave user's full authority, including its credentials and its
project checkouts. Adopting an existing session is equally reachable.

This is not a remote-exploit finding. It matters exactly to the degree that
something untrusted can run locally — which, on a developer machine that
executes agent-authored code, is not a remote scenario.

## Why the exemption exists

It is load-bearing, and removing it naively has already broken the product
once. The comments in `server.ts` record it: **#714 dropped this exemption and
401'd every local terminal**, reproducing the v0.0.72 "Terminal connection
failed" regression that `server-pty-ws.test.ts` still guards. `proxy.ts` and the
PTY path are deliberately symmetric so the desktop shell and a local browser
both work with no token configured.

So the requirement is not "add auth". It is **add auth without a credential
prompt for the two callers that legitimately have none today**: the Tauri shell
and a local browser tab.

## Options

| Option | Binds identity to | Works for Tauri shell | Works for local browser | Verdict |
| --- | --- | --- | --- | --- |
| Keep TCP + per-boot stamp | machine only | yes | yes | **status quo — the defect** |
| `SO_PEERCRED` / `LOCAL_PEERCRED` | OS uid, kernel-enforced | yes | — | Unavailable on TCP; needs a UDS |
| Unix domain socket, 0600 | OS uid, kernel-enforced | yes | **no** — browsers cannot speak UDS | Strongest, insufficient alone |
| Capability token in a 0600 file | filesystem ownership | yes — it can read the file | not directly — a page cannot read a file | Viable with a bootstrap |
| Capability token + one-time bootstrap URL | filesystem ownership, then cookie | yes | yes | **Recommended** |
| OS keychain item | OS user | yes | no | Same browser gap, more moving parts |

## Recommendation

A **per-boot capability token, written to a mode-0600 file under the user's own
state directory**, required for privileged loopback operations. Another OS user
cannot read the file, so possession of the token is evidence of being *this*
user — the property TCP loopback cannot supply.

Delivery differs by caller, which is the whole compatibility story:

- **Tauri shell** — reads the file directly at startup and attaches the token
  on REST and on the PTY upgrade. No user-visible change.
- **Local browser** — cannot read a 0600 file, so it is bootstrapped exactly
  once: the dev server prints a loopback URL carrying the token (the model
  Jupyter and VS Code tunnels use), and the first request exchanges it for an
  `HttpOnly`, `SameSite=Strict`, loopback-scoped session cookie. Subsequent
  navigations carry the cookie. The token never appears in a page or in
  `document.cookie`.
- **Explicit tokenless development** stays available, but must become
  *deliberate* rather than the silent default: an environment variable whose
  name says what it does, refused when the process is not on loopback, and
  surfaced in the UI so a machine left in that mode is visible rather than
  quietly open.

A Unix domain socket remains the stronger endpoint for the PTY specifically,
and nothing here forecloses it — the token path is what keeps the browser
working, and the two compose.

## Decision matrix

The contract the tests should pin. "Token" means the capability token or the
cookie minted from it.

| Caller | Transport | Credential | REST `/api/**` | PTY upgrade |
| --- | --- | --- | --- | --- |
| Tauri shell | loopback | token | allow | allow |
| Local browser, bootstrapped | loopback | cookie | allow | allow |
| Local browser, not yet bootstrapped | loopback | none | redirect to bootstrap | 401 |
| **Other local OS user** | loopback | none | **401** | **401** |
| Any local caller | loopback | wrong/expired token | 401 | 401 |
| Tailscale-forwarded device | forwarded | allowlisted tailnet node | allow | allow |
| Tailscale-forwarded device | forwarded | access token | allow | allow |
| Tailscale-forwarded device | forwarded | none | 401 | 401 |
| Any caller | non-loopback `Host` | none | 403 | 403 |
| Explicit tokenless dev opt-in | loopback | none | allow | allow |
| Explicit tokenless dev opt-in | forwarded | none | **401** | **401** |

The fourth row is the defect this design closes. The last row matters nearly as
much: the tokenless escape hatch must never widen remote access.

## What this does not change

- The forwarding-header and `Host` checks stay exactly as they are; they are
  what keeps a Serve-forwarded phone from being read as local, and this design
  adds to them rather than replacing them.
- The tailnet-node path is untouched. A WireGuard-backed device identity is
  already stronger evidence than a shared bearer token.
- No change to what any surface can do once authenticated. This is about who is
  admitted, not about authorization.

## Rollout

Sequenced so the terminal never breaks, because it already has once:

1. Mint and persist the token; attach it in the Tauri shell; **accept it but do
   not yet require it**. Ship the decision-matrix tests against current
   behavior so the change in each cell is visible in a diff.
2. Add the browser bootstrap and cookie exchange.
3. Flip the PTY path to require it, keeping the explicit tokenless opt-in.
4. Flip REST.
5. Consider a UDS endpoint for the PTY as defence in depth.

Each step is independently revertible, and steps 3 and 4 are the only ones that
can lock anyone out. Verify both in the native Tauri shell before landing —
headless checks did not catch #714.

## Verification this design owes

- Decision-matrix tests for REST and PTY covering every row above, including
  the tokenless-opt-in rows.
- A test that a second local user cannot authenticate. Simulated by presenting
  no token from a loopback socket, since a test cannot become another uid.
- A regression test for #714: the local terminal connects with no user-visible
  credential step, in the shell and in a local browser tab.
- Proof that the token file is 0600 and refused when it is a symlink.
- Proof the tokenless opt-in refuses to widen a forwarded request.
