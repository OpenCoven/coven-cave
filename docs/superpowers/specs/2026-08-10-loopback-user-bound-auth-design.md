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

## Scope decision: the desktop shell is the only credentialed caller

Settled at the owner's direction, and it is the decision that shapes everything
below: **a local browser tab is not a first-class authenticated caller.** Only
the Tauri shell holds a credential.

That removes the hardest constraint in this design. Every option below was
previously judged on whether a web page could satisfy it, and the browser is
the reason the weaker options were even on the list — a page cannot read a
0600 file and cannot speak a Unix socket, so accommodating it forced a
credential through a URL. With the browser out of scope, the strongest
mechanism available becomes the simplest one to adopt.

The cost is real and stated plainly rather than buried: **browser-driven work
now depends on the explicit tokenless opt-in.** That covers `pnpm dev` in a
normal browser, the browser-driven verification flows, and any Playwright run
that is not already daemon-less. Those become deliberate opt-in territory
instead of silently authenticated, which is the point — but it is a workflow
change, not merely a security tightening, and whoever implements it should
expect to touch those entry points.

## Options

| Option | Binds identity to | Works for Tauri shell | Verdict |
| --- | --- | --- | --- |
| Keep TCP + per-boot stamp | machine only | yes | **status quo — the defect** |
| Capability token in a 0600 file | filesystem ownership | yes — it reads the file | Good; portable |
| Unix domain socket, 0600 + peer credentials | **OS uid, kernel-enforced** | yes | **Recommended** |
| OS keychain item | OS user | yes | Equivalent identity, more moving parts |
| ~~Capability token + bootstrap URL~~ | filesystem, then cookie | yes | **Dropped** — existed only to serve the browser |

A Unix domain socket is stronger than a token file in a way that matters: the
uid is supplied by the kernel on the socket itself (`SO_PEERCRED` on Linux,
`LOCAL_PEERCRED` / `getsockopt(SOL_LOCAL, …)` on macOS), so there is no secret
to leak, copy, or accidentally log. A token file is only as good as its
permissions and everything that ever reads it. On Windows the equivalent is a
named pipe with an ACL restricted to the current user.

## Recommendation

**Serve privileged loopback operations over a Unix domain socket whose peer uid
must equal the server's own**, with a named pipe restricted to the current user
as the Windows equivalent.

- **Tauri shell** — connects over the socket instead of TCP. It already owns
  its transport, so this is an internal change with no user-visible step: no
  token to store, no secret to leak, no file whose permissions can drift.
- **Everything else on TCP loopback** — keeps the existing `Host`, origin, and
  forwarding-header checks, and additionally requires a real credential
  (access token or allowlisted tailnet node) for anything privileged. The
  machine-only stamp stops being sufficient on its own.
- **Explicit tokenless development** stays available, but must become
  *deliberate* rather than the silent default: an environment variable whose
  name says what it does, refused when the request is not on loopback, and
  surfaced in the UI so a machine left in that mode is visible rather than
  quietly open. With the browser out of scope this is no longer a convenience —
  it is the sanctioned path for browser-driven development, so its ergonomics
  matter more than they would have.

Why the socket rather than the 0600 token file that was recommended before the
scope decision: the token existed to be *transportable* to a caller that could
not be identified any other way. Once the only credentialed caller is a process
we control, the kernel can answer the identity question directly and no secret
needs to exist at all. A token file is a secret whose safety depends on its
permissions staying right forever, on nothing logging it, and on no future
caller copying it somewhere convenient.

Keep the token file only if the shell's transport turns out to be impractical
to move — it is a genuine fallback with a materially weaker guarantee, not an
equal alternative.

## Decision matrix

The contract the tests should pin. "Access token" is the existing shared
credential; the desktop shell presents no token at all, because the socket
identifies it.

| Caller | Transport | Credential | REST `/api/**` | PTY upgrade |
| --- | --- | --- | --- | --- |
| Tauri shell | **unix socket** | kernel-verified peer uid | allow | allow |
| Any caller | unix socket | peer uid ≠ server uid | **401** | **401** |
| Local browser | loopback TCP | none | **401** | **401** |
| Local browser | loopback TCP | access token | allow | allow |
| **Other local OS user** | loopback TCP | none | **401** | **401** |
| Any local caller | loopback TCP | wrong/expired token | 401 | 401 |
| Tailscale-forwarded device | forwarded | allowlisted tailnet node | allow | allow |
| Tailscale-forwarded device | forwarded | access token | allow | allow |
| Tailscale-forwarded device | forwarded | none | 401 | 401 |
| Any caller | non-loopback `Host` | none | 403 | 403 |
| Explicit tokenless dev opt-in | loopback TCP | none | allow | allow |
| Explicit tokenless dev opt-in | forwarded | none | **401** | **401** |

Row five is the defect this design closes — and note it is now closed by the
*absence* of a rule rather than the presence of one: nothing on TCP loopback is
privileged by virtue of being local, so there is no exemption left to get wrong.

Row three is the deliberate cost of the scope decision. A plain local browser
gets 401 unless it presents a token or the tokenless opt-in is on. The last row
still matters most for safety: the escape hatch must never widen remote access.

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

1. Ship the decision-matrix tests against **current** behavior, so every cell
   that changes later shows up as a deliberate diff rather than a surprise.
2. Open the unix socket alongside the existing TCP listener and serve both.
   Nothing requires it yet; nothing can break.
3. Move the Tauri shell onto the socket. Verify in the native shell, at both
   pane widths, that the terminal and REST still work.
4. Make the tokenless opt-in explicit, named, loopback-only, and visible in the
   UI — **before** anything starts refusing, so the escape hatch exists by the
   time people need it.
5. Remove the direct-loopback exemption from the PTY path.
6. Remove it from REST.

Steps 5 and 6 are the only ones that can lock anyone out, and by then the shell
is already off TCP and the opt-in already exists. Each step is independently
revertible.

Verify steps 3, 5 and 6 in the native Tauri shell rather than headlessly.
Headless checks did not catch #714, and the failure mode is specifically that
the terminal stops connecting — which a passing API test will not show.

Note for step 5: `server.ts` currently reads `isDirectLoopbackRequest(req)`
twice for two different purposes — stamping the local-peer header, and skipping
the PTY 401. Only the second is being removed. Deleting the helper outright
would also break the stamp that the Serve-forwarding logic depends on.

## Verification this design owes

- Decision-matrix tests for REST and PTY covering every row above, including
  the tokenless-opt-in rows. Landed **first**, against current behavior, so
  each later flip shows up as a deliberate diff.
- A test that a socket peer whose uid differs from the server's is refused.
- A test that an uncredentialed loopback TCP caller is refused once steps 5–6
  land — the defect row, asserted directly rather than implied.
- A regression test for #714: the local terminal connects with no user-visible
  credential step **in the native shell**.
- Proof the socket path is 0600, refused when it is a symlink, and unlinked on
  clean shutdown rather than left claimable by whoever binds it next.
- Proof the tokenless opt-in refuses to widen a forwarded request.
- A test that a plain local browser is refused without the opt-in — the cost of
  the scope decision, pinned rather than discovered later by a confused
  developer.
