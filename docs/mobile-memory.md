# Coven Memory mobile access — removed 2026-09-16

This page described the Coven Memory iOS client's read-only access to Cave's
canonical-memory API. That API no longer exists.

#5418 (commit `8f2f4be01`) extracted the canonical memory vault from the Cave.
It removed `/api/coven-memory/**`, `/api/mobile/coven-memory/**`, the canonical
memory gateway and its reader surfaces, and the
`tests/fixtures/mobile-canonical-memory-v1` fixture. Memory now lives in the
dedicated memory application.

What remains in Cave is separate from that vault:

- The `MEMORY.md` file scan (`/api/memory`) that familiar contracts check.
- The **Open on phone** bearer/Tailscale boundary, described in
  [`mobile-tailscale.md`](mobile-tailscale.md), with token refresh at
  `/api/mobile-token/refresh`.

The full previous text is in this file's history before 2026-10-25.
