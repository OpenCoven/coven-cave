# Client access settings

Open **Settings → Client access** to review apps requesting access to Cave and
to revoke credentials that Cave has already issued.

## Pending requests

Each request shows the app name, installation ID, requested scopes, creation
time, expiry, and current state. Confirm that the app and installation are the
ones you intended to pair, then choose:

- **Approve** — allows that request to exchange its one-time secret for a
  credential carrying exactly the displayed scopes.
- **Deny** — permanently rejects that request. A denied request cannot be
  exchanged later.

Requests expire five minutes after creation. The section refreshes while it is
active and pauses polling when Settings is elsewhere or the app is hidden.
Actions are disabled while a mutation is in flight to prevent duplicate
decisions.

## Issued credentials

Issued credentials show app and installation identity, granted scopes, creation
time, last-use time, and revocation state. Cave never displays the bearer or its
stored hash.

Choose **Revoke** when an installation is retired, lost, compromised, or no
longer needs access. Revocation is immediate; the client must pair again before
it can call scoped routes. Historical revoked entries remain visible with their
timestamp and reason so operators can audit what happened.

## Operational notes

- Client access management is available only through an authenticated Cave
  desktop session. If Cave reports that admin authorization is unavailable,
  restart it through the desktop app rather than bypassing the check.
- Admin mutations require a same-origin browser source. Do not expose or proxy
  the admin route family to another origin.
- Pair only apps you recognize and grant the narrowest useful scopes.
- A pairing secret or bearer must never be pasted into chat, logs, issues, or
  screenshots. Cave stores bearer hashes only; the paired native client owns
  secure bearer storage.
- If an action fails, use **Retry** to refresh current state before deciding
  again. Do not assume a timed-out UI request means the server mutation failed.

See [`api/client-v1.md`](api/client-v1.md) for discovery, pairing, envelopes,
and the supported scope contract.
