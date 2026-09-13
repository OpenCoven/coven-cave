# Desktop-managed device access

Settings > Phone > Device access provides an explicit migration from invite
pairing to per-device approval. Until the operator saves the first tailnet
policy, existing invite behavior is unchanged. Enabling device approval
invalidates legacy remote authorization, including open remote connections.
Local desktop access stays available.

## Pairing and revocation

1. Enable mobile mode using the existing desktop availability consent.
2. Open Device access and save exact allowed tailnet DNS suffixes, such as
   `example.ts.net`. No wildcard or "all networks" policy is supported.
3. Scan the current pairing code on the requesting device. It opens the
   published HTTPS origin's `/connect` page, including any configured Serve
   port; it carries no approval secret.
4. Request access, compare the short request code on both devices, and choose
   **Allow** or **Deny** in the desktop's device list.
5. Choose **Revoke access** to stop future access and close active connections.

Pending requests expire after five minutes. Approval has no scheduled expiry.
The browser keeps an HttpOnly, Secure, SameSite cookie. Pairing JSON contains
only device metadata; the native app reads the credential from `Set-Cookie`
and keeps it in Keychain, pinned to the selected HTTPS origin. Native avatar
requests carry credentials in Authorization headers, never in URLs. A credential
is not transferable to a different Tailscale node or user. Clearing browser
storage, reinstalling the client, or losing its credential requires another
request; it does not silently recover the previous approval.

Removing a tailnet revokes its approved devices and denies its pending requests
in the same transaction. Readding the tailnet never restores those grants.
An enabled policy with no allowed tailnets denies every remote device; it
does not fall back to old invite tokens.

## Identity and authority

The binding is the tailnet DNS suffix, stable Tailscale node ID, Tailscale user
ID, client installation ID, and possession of a random per-device credential.
Device labels and IP addresses are not the persisted authority. Tailscale's
local inventory supplies node/user membership; requests must arrive through
the loopback HTTPS Serve forwarding path with matching host, source address
and login. Forwarding chains, Funnel, tagged nodes, expired nodes, and unknown
identities fail closed. Membership is refreshed at most ten seconds apart;
failed refreshes discard the cache and stop access.

The trust boundary includes the desktop OS account, its Tailscale daemon, and
the loopback backend. This is not cryptographic attestation against another
process on the desktop: a local process can forge forwarded candidate headers.
Comparing the request code is therefore part of approval, not an optional
device-name check. Custom control planes and nonstandard identity headers are
not supported by this pairing contract.

An approval grants existing remote Cave application access. It does not grant
local administration, terminal/WebSocket access, or remote client-v1 execution
authority. Existing mobile write permissions and passkey-presence policy still
apply. Device management itself requires direct local ingress and, in packaged
mode, the desktop's sidecar credential.

## Persistence and audit

The private server-side SQLite store holds credential hashes, decisions,
policy, timestamps, and audit events. Decisions and policy changes are
transactional with their audit records. Successful application requests persist
an admission record before dispatch and return `x-coven-request-id`; completion
or connection cancellation is recorded with the same ID. An abrupt process
death can leave an admission without completion, which is not proof that an
operation finished. Audit failure before admission refuses the request.

Access history shows recent records, decision attribution to the local OS
account, request method/path, status, and trace ID. Query strings, request bodies
and raw credentials are not included. Attribution identifies the desktop
authority, not biometric proof of a particular human. The local audit is not
tamper-proof against the machine owner.

The desktop must remain awake and reachable. Network outages do not revoke
saved approvals. This feature does not change sleep policy, configure public
Funnel ingress, or automatically allow any actual device.
