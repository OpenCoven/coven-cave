# Event plane operations

The event plane is a WebSocket that tells clients a snapshot may be stale. It
carries invalidations only, never resource payloads, and REST stays the source
of truth. It is an optimization, not a dependency: with it off or broken, every
surface falls back to the polling it had before.

Design: [the event-plane spec](superpowers/specs/2026-08-28-demand-driven-websocket-event-plane-design.md).
Plan: [the implementation plan](superpowers/plans/2026-08-28-demand-driven-websocket-event-plane.md).
Tracking: `cave-qjvbb` on the Cave project.

## At a glance

| | |
| --- | --- |
| Capability | `GET /api/events/capability`, answered even while the daemon is down |
| Endpoint | `/api/events-ws` on the existing Cave HTTP server, same host |
| Protocol | version 1, shared golden fixture at `apps/ios/CovenCave/CovenCaveTests/Fixtures/cave-event-plane-v1.json` |
| Topics | `sessions`, `board`, `runs`, `familiars`, `daemon` |
| Close codes | `4400` unsupported protocol, `4402` invalid frame, `4408` slow consumer |

## Turning it on and off

The plane is off unless the server is started with the master switch, and each
platform's rollout mode is set independently. Every value defaults to `off`,
and an unrecognized value fails closed to `off`.

```sh
COVEN_CAVE_EVENT_PLANE_ENABLED=1     # master switch; anything but 1/true is off
COVEN_CAVE_EVENT_WEB_MODE=shadow     # browser and Tauri: off | shadow | primary
COVEN_CAVE_EVENT_IOS_MODE=off        # native iOS:        off | shadow | primary
COVEN_CAVE_EVENT_RING_COUNT=2048     # optional replay ring size, capped at 16384
```

| Mode | Connects | Event-triggered reads | Polling |
| --- | --- | --- | --- |
| `off` | no | none | authoritative |
| `shadow` | yes, while something subscribes | none; events are validated, acknowledged and counted | authoritative |
| `primary` | yes, while something subscribes | each invalidation refreshes its owner | only covered polls pause, and only while the topic is ready |

**Kill switch.** Unset `COVEN_CAVE_EVENT_PLANE_ENABLED`, or set it to `0`, and
restart Cave. The capability then says `enabled: false`, the upgrade is refused
without disclosing broker state, and every client stays on polling. Setting a
platform's mode to `off` stops just that platform.

## What each platform actually pauses

The plan allowed primary mode to pause any covered poll. What shipped is
narrower, on purpose.

- **Browser and Tauri pause only board reads.** On 2026-10-08 Val chose "board
  only" (#5858). While `board` is ready in primary mode, two polls pause with
  their focus refreshes: the Board view's 15-second poll, and the workspace's
  60-second read for the Tasks badge and calendar deadlines (#5869). Both
  share one cache entry, and an event invalidates it once, so one write costs
  one read for both. Sessions and daemon polling stay
  authoritative, because daemon-owned sessions change without Cave observing
  them: flows, the CLI, and automations. Those polls can pause once the daemon
  offers a changefeed.
- **iOS pauses nothing.** iOS has no task-list poll, and the familiar
  dashboard's 30-second refresh reads daemon-owned data. Primary mode makes the
  session list, tasks and familiars refresh sooner, through their existing
  single-flight loaders.
- **`runs` is never published.** Automation runs belong to the Coven daemon,
  and its SDK has no global feed (#5843). The topic stays in the protocol so a
  later publisher needs no protocol change.

Invalidations come from the durable write paths: `saveBoard()`, the
session-list cache invalidation, a `board.json` file watch for writes from
other processes, and watchers for daemon health and the familiar roster.

## Security

- **Same host.** The upgrade runs through the same source gate as other
  upgrades: same-host and Origin checks, with direct loopback allowed.
- **Remote clients need a credential.** That is a signed mobile access token or
  the packaged sidecar's credential. Without one, a remote upgrade gets 401 or
  403, and an authentication failure discloses no topic, cursor or epoch.
- **No passkey for events.** The event socket carries invalidations only, so it
  does not inherit the PTY's remote passkey-presence gate. The PTY keeps that
  gate on its own.
- **iOS sends a credential only where REST would.** The socket URL is `wss://`
  for an `https://` connection and `ws://` for `http://`. A credentialed socket
  is refused to a remote plaintext host, and the token must match the origin
  it was issued for.
- **Managed device grants get no socket.** Device access keeps WebSocket scopes
  off managed grants (258e587f9), and `DeviceAccessTests` pins it. A phone
  paired that way keeps polling. Widening that is a device-access policy
  decision, not an event-plane one.

## Recovery

- **Resume.** A client reconnects with its epoch and sequence. The server
  replays the retained suffix when it still has it.
- **Full resync.** A restarted server, which has a new epoch, or a cursor older
  than the ring gets `resync-required`. The client then reloads each topic over
  REST.
- **Barrier.** Readiness comes only from a `ready` barrier that installed the
  topic. A topic added later stays unready until the replacement barrier
  arrives.
- **Fallback.** Whenever a topic isn't ready, its poll runs. That covers a
  capability that is off, a socket that is connecting, backing off or degraded,
  and an unfinished resync.
- **Backoff.** Reconnects start at 500 ms, double to a 30-second cap, and add
  ±20% jitter. A `4400` close re-reads the capability (web) or waits for the
  next foreground (iOS) instead of retrying.
- **iOS lifecycle.** The socket opens only while the scene is active. It closes
  with `1001` in the background, keeps its cursor in memory, and resumes on
  foreground.

## Diagnostics

All diagnostics are aggregate counts. None of them carry credentials, epochs,
cursors, entity ids or payloads.

| Where | What it shows |
| --- | --- |
| `/api/daemon/diagnostics`, field `eventPlane` | enabled, active and ready connections, subscriptions and invalidations per topic, replay gaps, slow-consumer closes |
| Debug pane, **Event plane** section | this browser's mode, state, reconnects, invalidations seen and delivered, coalesced invalidations, fallback activations, polls avoided |
| Performance report, **Event plane counters** | the broker's counters after a deterministic in-process workload |
| iOS `AppModel.eventPlaneHealth` and `CaveEventSocket.diagnostics()` | mode, state, ready topics; opens, reconnects, invalidations observed and delivered, duplicates suppressed, resyncs, acks, invalid frames |

## Verification

| Command | What it proves |
| --- | --- |
| `node --experimental-strip-types --test src/lib/cave-event-plane-protocol.test.ts` | the TypeScript side of the shared fixture and the literal wire pins |
| `xcodebuild test … -only-testing:CovenCaveTests/CaveEventWireTests` | the Swift side of the same fixture and pins |
| `node scripts/event-plane-runtime-conformance.mjs` | the built server: capability, upgrade security, hello and ready, publishers, replay |
| `node scripts/event-plane-request-count.mjs` | a real browser: no recurring board reads in a healthy 60-second window from either board poll, bounded reads for a write burst, and polling back when the socket is refused |
| `pnpm test:sidecar-runtime` | the packaged sidecar: capability, socket with the sidecar credential, diagnostics, one board round trip |

Run `pnpm build` before the conformance, request-count and sidecar checks. Each
one starts its own Cave in a scratch home and never touches `~/.coven`.
