# Client access in Settings

Use this page when you operate **Settings → Client access** in Cave. For the
full route contract, envelope shapes, and error/status tables, see
[Client v1 HTTP API](api/client-v1.md).

This guide covers the eight shipped Client v1 routes that support the current
approval workflow: `GET /api/client/v1/health`, the three pairing routes, and
the four administrator routes behind the Settings surface.

## Open the section

Open **Settings → Client access**. In the Settings nav, the section sits
between **Daemon** and **Phone**.

The surface has one header and two lists:

- **Pending approvals** — live pairing requests that are still waiting for a decision.
- **Issued credentials** — active credentials and revoked credential tombstones.

The header counts come from the last **fully confirmed** snapshot of both lists:

- **pending** = rows returned by `GET /api/client/v1/admin/pairing-requests`
- **active credential(s)** = credential rows whose `revokedAt` is still `null`
- **revoked credential(s)** = credential rows whose `revokedAt` is set

Counts appear only after the first confirmed snapshot. If one list fails to
refresh, the header keeps the last fully confirmed counts until the next
successful full refresh.

The section loads both lists when you open it, polls again every 30 seconds
while idle, and offers **Refresh** for a manual reload.

## Review a pending approval

Before you approve or deny a request, verify all of the metadata Cave shows for
that row:

- **App name** — confirm it matches the client the operator expects.
- **Installation** — confirm the installation identity matches the specific
  install you intend to authorize.
- **Scopes** — confirm the requested scopes are the smallest set that install
  needs.
- **Requested / Expiry** — confirm the request is still fresh. Pairing requests
  expire five minutes after creation.

Approval is all-or-nothing. Settings cannot trim scopes on an existing request.
If a client asks for more than you want to grant, deny it and have the client
create a narrower request.

Pending approvals only lists live `pending` requests. Approved, denied,
expired, and already-exchanged requests do not remain in this list.

## Approve or deny

**Approve** records `status: "approved"` and `decidedAt`, removes the row from
**Pending approvals**, and refreshes both sections.

Approval does **not** issue a credential by itself. The client still has to
call `POST /api/client/v1/pairing/requests/:id/exchange` with the pairing
secret before `expiresAt`.

If exchange succeeds:

- Cave returns the bearer **once**.
- Cave persists only the bearer hash.
- The new credential appears in **Issued credentials** on the next successful
  ledger refresh after exchange.

If exchange fails with `internal_error`, Cave restores the pairing request to
its approved, exchangeable state so the client can retry without asking you for
a second approval.

**Deny** records `status: "denied"` and `decidedAt`, removes the row after
refresh, and issues no credential. A client that tries to exchange a denied
request receives `pairing_denied`.

If another actor already decided the request or it expired before your click
landed, Settings keeps the failure message, refreshes the pending queue, and
shows the current ledger. If the failure is non-terminal, such as a timeout or
`service_unavailable`, Settings leaves the row in place so you can retry after
the underlying problem is fixed.

## Issued credentials

**Issued credentials** shows active and revoked credential metadata:

- app name
- installation identity
- granted scopes
- creation time
- last-used time
- revoked time and reason, when present

Active credentials keep working until you revoke them. Revoked records stay listed for audit.

`Last used` updates only when a shipped bearer-authenticated route accepts that
credential. Cave coalesces those writes to at most once per minute per
credential, so repeated successful reads can leave the displayed timestamp
unchanged for up to a minute.

## Revoke a credential

Use **Revoke** on an active credential when that install should stop reading
the Client v1 surface.

Revocation:

- sends the fixed reason `revoked from Settings`
- sets `revokedAt` and `revocationReason`
- keeps the record as a revoked tombstone
- refreshes the ledger after the mutation

The effect is immediate for shipped bearer-authenticated routes. A revoked bearer stops authenticating and later reads answer `unauthorized`.

Client repair is a fresh pairing flow:

1. delete the cached bearer
2. re-read discovery and `/health` if needed
3. create a new pairing request
4. approve and exchange again

Cave cannot re-display the old bearer. If the authoritative refresh fails after
a successful revoke, Settings keeps the locally revoked row visible and warns
that the ledger could not refresh.

## Current scopes and least-privilege guidance

Today only one shipped scope is consumed by a live route family. The other five
scopes are recorded on the credential but no shipped Client v1 route reads them
yet.

| Scope | Current effect | Least-privilege guidance |
| --- | --- | --- |
| `chat:read` | Required by all five shipped bearer-authenticated read routes. | Grant this for the current read-only surface. |
| `chat:write` | Recorded on the credential only. No shipped route reads it yet. | Do not grant unless you intentionally want that install to retain the scope ahead of future write routes. |
| `conversations:write` | Recorded only. No shipped route reads it yet. | Same guidance: deny and ask for a narrower request if the client does not need it today. |
| `attachments:write` | Recorded only. No shipped route reads it yet. | Treat as unnecessary for the current shipped surface. |
| `tasks:write` | Recorded only. No shipped route reads it yet. | Treat as unnecessary for the current shipped surface. |
| `github:write` | Recorded only. No shipped route reads it yet. | Treat as unnecessary for the current shipped surface. |

Because approval is all-or-nothing, the safest default today is usually **`chat:read` only**.

## Security model

- Pairing requests are process-local and in-memory. Cave keeps the pairing
  **secret hash**, not a re-readable secret, after creation.
- The persistent credential store writes **bearer hashes only** to
  `<cave home>/client-v1-credentials.json`. The exchange response is the only
  time Cave returns the raw bearer.
- The Settings surface renders metadata only. It does not display pairing
  secrets, bearers, bearer hashes, or the per-launch admin token.
- The first-party desktop Settings document reaches the admin routes through
  same-origin `/api/*` requests that receive `x-coven-cave-token` from the
  sidecar auth bridge. Admin mutations still require same-origin `Origin` or
  `Referer` plus direct loopback transport.
- External clients do not receive the admin token. They pair through the public
  routes and must store the returned bearer in platform secure storage, keyed
  by `instanceId`.

## Troubleshooting

### The section will not load or refresh

Use **Refresh** once first.

If the failure persists:

- **401 / 403** means the first-party admin auth boundary failed. Open the
  surface from the live desktop app window, not a stale or cross-origin browser
  tab, then refresh again.
- **503** with the desktop-app message means Cave is running without
  `COVEN_CAVE_AUTH_TOKEN`. In that tokenless local mode, clients can create
  pairing requests but nobody can list, approve, deny, or revoke them until
  Cave runs through the desktop app.
- If only one list fails to refresh, that section keeps its last empty or
  confirmed state visible and shows an inline error. The header keeps the last
  fully confirmed counts.

### A request expired or was already decided

If approve or deny returns an expired/not-found or already-decided failure,
Settings refreshes the pending queue automatically and keeps the failure
message visible.

- **Expired** means the client must create a new pairing request.
- **Already decided** means another actor already resolved it. Use the refreshed ledger rather than retrying blindly.

### The client reports a denied request

No credential was issued. The client has to start a new pairing request after
the operator intentionally starts the flow again.

### The client reports a revoked credential

The bearer is no longer valid. Remove the cached bearer from the client and
pair again. The revoked row stays visible in **Issued credentials** for audit.

### The client reports a version mismatch

Client v1 uses `GET /api/client/v1/health` before pairing. If the client says
it is below `minimumClientVersion`, update the client first, then start a fresh
pairing request. Settings cannot waive that contract.

### The client cannot find or reach this Cave

Client discovery is file-based:

- Cave publishes `<cave home>/client-v1-discovery.json` after startup.
- A clean shutdown removes the current record.
- A crash or forced kill can leave a stale record behind until the next successful Cave start overwrites it.

If a client is pointed at a dead endpoint, restart Cave, have the client
re-read `client-v1-discovery.json`, then confirm
`GET /api/client/v1/health` and `instanceId` before it reuses any cached
bearer.
