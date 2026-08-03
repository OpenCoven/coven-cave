# Coven Memory mobile access

Coven Memory for iOS is a read-only client of Cave's canonical-memory API. It
uses the existing **Open on phone** bearer/Tailscale boundary; there is no
second Coven listener, cloud relay, device-signature protocol, or direct phone
connection to the Coven daemon.

## Enable and pair

Mobile access is disabled until an operator starts the native-app flow. The
host needs a running local Coven daemon, Node and pnpm, Tailscale signed into
the same tailnet as the phone, and Tailscale Serve permission.

```bash
pnpm mobile:tailscale:app
```

The command keeps Next.js on loopback, publishes that backend with Tailscale
Serve, and prints a credential-bearing HTTPS pairing URL and QR code. In Coven
Memory, scan the QR or paste the URL. Do not send the URL through chat, paste it
into an issue, or capture it in a screenshot or terminal recording.

The app then reads only:

- `GET /api/mobile/coven-memory`
- `GET /api/mobile/coven-memory/overview`
- `GET /api/mobile/coven-memory/{id}`

Every request needs a currently valid mobile bearer credential. Cave validates
that boundary before reading configuration or contacting the loopback Coven
socket. The routes are read-only, force dynamic responses, return
`private, no-store`, omit daemon paths, and fail closed when Coven is missing,
incompatible, or returns an invalid payload.

## Status, stop, and recovery

```bash
pnpm mobile:tailscale:status
pnpm mobile:tailscale:stop
```

Status output redacts the credential. Stop terminates tracked mobile servers
and resets Tailscale Serve. It does not rotate the persisted shared access
secret, so starting again lets already-paired clients reconnect.

Current Cave mobile access has no per-device registry or per-device host-side
revoke command. For a lost device or suspected invite disclosure, revoke all
paired clients by stopping the service, deleting the exact `access-token` file
inside the state directory printed by `pnpm mobile:tailscale:status`, and then
starting `pnpm mobile:tailscale:app` again. Confirm the path is the printed
per-port mobile state directory before deletion. Re-pair each trusted device.
On the phone, **Pair again** deletes only that phone's Keychain connection.

If pairing or refresh fails:

1. Confirm `tailscale status --self` succeeds on the host and phone.
2. Confirm `pnpm mobile:tailscale:status` reports the tracked loopback server.
3. Stop the service and verify stale Serve state is gone.
4. Start the native-app flow again and use the newly printed invite.
5. Update Cave when the app reports an unsupported protocol or invalid host
   response.

## Threat boundary

- Tailscale membership is private routing, not authorization; the bearer is
  still required.
- The Cave server remains loopback-bound. Never substitute `0.0.0.0` or a LAN
  bind for Tailscale Serve.
- Cave injects access to the local Coven socket; the phone never receives a
  socket path or transport credential.
- The iOS client stores only its Cave URL and bearer in the device-only
  Keychain. Memory data is retained in memory only and is purged on lock,
  background, reader dismissal, reset, or auth failure.
- A device owner can still screenshot, screen-record, or photograph visible
  content. Operational evidence must use synthetic fixtures and status-only
  results.
- Do not log request authorization, invite URLs, private endpoints, memory
  bodies, excerpts, or device identifiers.

The cross-repository fixture contract lives at
`tests/fixtures/mobile-canonical-memory-v1` in Cave and
`apps/ios/CovenMemory/Tests/Fixtures/cave-mobile-memory-v1` in coven-memory.
Both copies are deterministic and synthetic.
