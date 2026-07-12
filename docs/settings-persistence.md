# Desktop settings persistence

CovenCave's packaged desktop shell starts its Next.js sidecar on an available
loopback port. That port may change after any restart. Browser storage is keyed
by origin, including the port, so `localStorage` and IndexedDB cannot be the
authoritative store for desktop preferences.

## Canonical store

Non-secret UI preferences are stored in the app-owned JSON file
`~/.coven/cave-preferences.json`. `COVEN_PREFERENCES_PATH` may redirect it for
tests. Backdrop image bytes are stored separately at
`~/.coven/cave-backdrop.jpg` (or `COVEN_BACKDROP_PATH`) and the JSON file holds
only its safe metadata.

The sidecar exposes a typed, loopback-only `GET`/`PATCH /api/preferences`
interface. Writes are validated, atomically replaced, serialized within a
sidecar, and ordered across overlapping sidecar processes with uniquely owned
write intents. The
schema rejects unknown fields and deliberately has no credential or token
fields. Existing sidecar authentication remains in front of the routes;
backdrop access receives an additional local-host check. No Tauri permission is
added by this design.

Client preference helpers optimistically update the current document and send
coalesced patches to that API. Browser storage remains a compatibility mirror,
not a source of truth. New local UI settings should be added to the typed
preference schema and this facade instead of introducing a new authoritative
`localStorage` key. Transient network/server failures receive bounded backoff;
terminal client/auth failures are retained without an endless retry loop.

## Startup and theme synchronization

The root layout reads the canonical file while rendering and embeds an escaped
JSON bootstrap before the external theme-init script. The script applies theme,
mode, custom variables, font, scale, reading, date/time, and corner choices
before first paint. This retains flash-free startup even on a brand-new port.

`/api/theme` remains the phone-compatible view of the same canonical store.
Theme selection changes have a monotonic selection revision. Desktop token
publishes include the selection revision they were derived from, so stale token
work cannot overwrite a newer local or phone selection. A fresh desktop origin
therefore applies the canonical selection rather than adopting an empty-origin
baseline. An always-mounted controller follows OS color-scheme changes while
System mode is selected and reconciles canonical updates from other windows on
every surface, not only while Settings is open.

Selecting or remotely applying a preset clears only CSS variables owned by the
previous custom theme. Font, scale, reading, corner, date/time, backdrop, news,
and mobile-mode preferences remain intact unless the user explicitly changes
them.

## Migration and recovery limits

On the first launch without a canonical preferences file, the client merges
recognized legacy keys from the currently loaded origin and persists the
result. A legacy `~/.coven/cave-theme.json` can provisionally seed the theme,
and a legacy IndexedDB backdrop is copied to the app-owned backdrop endpoint
after authenticated bootstrap even when the backdrop is disabled. Only a
confirmed central 404 permits that import; transient failures remain retryable,
and an explicit central clear leaves a metadata tombstone so preserved legacy
bytes are not resurrected. Old browser values are left in place.

The Web storage same-origin policy prevents code running on the new sidecar
port from enumerating or reading storage buckets belonging to old random ports.
Those otherwise valid buckets cannot be recovered automatically. Running a
build once on an origin that still has the old data allows the best-effort
migration; otherwise the old data remains untouched for manual/browser-level
recovery. This limitation is why all covered settings now use the port-independent
store.
