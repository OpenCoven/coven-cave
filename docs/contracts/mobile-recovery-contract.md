# Cave Mobile Recovery Contract

Status: proposed executable contract

## Purpose

Cave mobile access must recover from transport drift without weakening authentication or requiring physical access to the desktop.

This contract is based on the reproduced failure on 2026-08-26 where the packaged Cave process was healthy on `127.0.0.1:3020`, Tailscale was healthy, the iPhone was reachable, but the stable Tailscale Serve hostname had drifted to a different local development server. After Serve was repointed to the packaged backend, Cave 0.3.9 still rejected the route because its JSON status interpretation did not recognize the already-live Serve configuration.

## Security boundary

Recovery MUST NOT turn tailnet membership into authorization. Transport recovery and pairing authorization remain separate:

1. Tailscale proves a private route to the machine.
2. Cave proves that the route terminates at the intended packaged Cave backend.
3. A mobile credential or explicit pairing ceremony authorizes the client.
4. Recovery may repair transport automatically, but MUST NOT mint, disclose, or silently replace a client credential merely because a tailnet peer is present.

## Invariants

### R1 — Packaged backend ownership

When packaged Cave mobile availability is enabled, the canonical Serve root for that machine MUST target the packaged Cave loopback backend selected for the current process.

A route pointing at another Cave checkout, worktree, dev server, or stale port is `serve_drift` even if that process is healthy.

### R2 — Reclaim, never kill

When `serve_drift` is detected, packaged Cave MUST reclaim its own Serve route by publishing its current loopback backend. It MUST NOT kill the process currently owning the stale target port.

### R3 — Mutation acknowledgement is evidence

A successful `tailscale serve --bg <expected-backend>` command is authoritative evidence that Tailscale accepted the requested route mutation for this recovery attempt.

A subsequent `tailscale serve status --json` read is corroborating evidence, not a veto. Parser/schema drift in the status payload MUST NOT convert an acknowledged successful mutation into `route_not_found`.

If the Serve mutation itself fails, Cave remains fail-closed: a matching status route is then required before Cave may claim the route is live.

### R4 — Never infer authorization from route health

A repaired Serve route does not imply a paired iPhone. If the client credential is absent, expired, revoked, or belongs to another Cave authority, Cave reports `pairing_required` and performs the normal explicit pairing flow.

### R5 — Existing credentials survive port changes

Changing the packaged loopback port or reclaiming Serve MUST NOT rotate the persisted mobile access secret solely because the backend port changed. A still-valid paired credential should reconnect after transport repair.

### R6 — No secret logging

Recovery diagnostics MUST redact mobile access tokens, pairing secrets, sidecar tokens, invite URLs, cookies, and bearer credentials. Diagnostics may expose backend host/port, Serve hostname, process identity, recovery state, and timestamps.

### R7 — Deterministic state machine

The recovery state machine is:

`healthy -> detecting -> reclaiming -> verifying -> recovered`

or, on failure:

`healthy -> detecting -> reclaiming -> verifying -> degraded(<reason>)`

Recognized degraded reasons include `tailscale_missing`, `tailscale_stopped`, `tailscale_signed_out`, `backend_unreachable`, `serve_mutation_failed`, `serve_unverified`, and `pairing_required`.

`pairing_required` is not a transport failure and MUST NOT trigger repeated Serve mutations once the expected backend is proven.

## Recovery algorithm

1. Determine the current packaged Cave loopback backend from the running server process; never assume port 3000/3100.
2. Verify that backend locally.
3. Read Tailscale self status and require a running, authenticated tailnet.
4. Read Serve status if available and compare the configured root proxy target with the expected backend after normalizing `localhost`/`127.0.0.1` and trailing slashes.
5. If the expected route is already present, mark transport healthy.
6. Otherwise issue `tailscale serve --bg <expected-backend>`.
7. If the mutation succeeds, derive the stable MagicDNS HTTPS endpoint from self status even if the follow-up JSON status payload cannot be parsed into the expected schema. Record the mismatch as diagnostic telemetry, not a recovery failure.
8. If the mutation fails, require an independently observed matching route before declaring success.
9. Probe the recovered endpoint without logging credentials.
10. Let the client authentication layer decide whether the existing credential is accepted. If not, surface `pairing_required` and offer the normal signed invite/deep-link ceremony.

## Golden scenarios

The implementation is not complete until automated tests cover:

- correct packaged backend already published;
- Serve root drifted to another Cave worktree;
- packaged Cave changes from one loopback port to another;
- `serve --bg` succeeds while `serve status --json` is empty;
- `serve --bg` succeeds while status JSON uses an unknown schema;
- `serve --bg` fails but status proves the expected route is already live;
- `serve --bg` fails and no matching route exists;
- Tailscale signed out/stopped/missing;
- backend unreachable;
- transport repaired and existing mobile credential still works;
- transport repaired but credential is stale, yielding `pairing_required` without another transport-repair loop;
- a foreign dev server on the stale target port is left untouched;
- diagnostics contain no credential material.

## Regression from the 2026-08-26 incident

Given:

- packaged Cave listens on `http://127.0.0.1:3020`;
- the stable HTTPS Serve hostname previously targeted another local server;
- `tailscale serve --bg http://127.0.0.1:3020` exits successfully;
- `tailscale status --self --json` contains the machine MagicDNS name;
- the follow-up Serve JSON parser does not identify the route;

Then Cave MUST still return a usable MagicDNS Serve URL and continue to signed invite generation. It MUST NOT return `tailscale serve route not found` merely because the status parser failed to corroborate an acknowledged mutation.

## Operational recovery command

Until every installed build implements this contract, an authenticated operator may safely reclaim the route without terminating unrelated worktree processes:

```bash
tailscale serve --bg "http://127.0.0.1:${CAVE_PACKAGED_PORT}"
tailscale serve status
```

Pairing credentials remain separate. Operators MUST use Cave's normal pairing ceremony or an already-authorized local sidecar path to mint an invite; raw secrets must never be copied into logs, tickets, or chat.

## Exit criteria

This contract is satisfied when a packaged Cave can recover from the reproduced Serve-drift incident without physical desktop access, without killing another local process, without exposing credentials, and with a deterministic test proving successful Serve mutation cannot be vetoed solely by status-schema drift.
