# iOS onboarding · constant connection · cloud persistence — review & plan

> Status: DRAFT (review in progress, 2026-07-09). This document is the planning
> anchor for three related threads: overhauling the iOS onboarding experience,
> making the desktop↔iOS connection feel constant, and adding cloud persistence
> as a backup for machine loss. Companion to [`golden-paths.md`](golden-paths.md)
> §5 (Take Cave with you) and the mobile docs
> ([`mobile-readiness.md`](mobile-readiness.md),
> [`mobile-tailscale.md`](mobile-tailscale.md),
> [`mobile-tailscale-native.md`](mobile-tailscale-native.md),
> [`ios-native-rebuild.md`](ios-native-rebuild.md)).

## Where we already are (shipped lineage)

- **Pairing card** (cave-rkiw): Settings → Phone is a one-scan card — Mobile
  mode switch auto-reconciles Tailscale Serve every 60s, QR pairs via camera,
  manual setup demoted to a disclosure.
- **Continue on phone** (cave-i74f, #2827): chat overflow → pairing modal; the
  QR carries `#chat-<id>` so the phone opens *that* conversation; token refresh
  records `lastSeenAt` → the card shows "Paired · last seen".
- **Connection stack hardening** (cave-30b, #2465): dedicated URLSessions (the
  60s resource-cap kill fix), SSE heartbeats every 20s, keepAliveTimeout 75s,
  PTY detach grace ~300s, signed v1 tokens on pty-ws, stream resync,
  NWPathMonitor + foreground-probe auto-recovery, 30-day rolling token refresh.
- **Honest auth failure** (cave-wkp5, #2884): an expired token no longer
  masquerades as "Daemon offline"; iOS maps 401/403 → `.needsAuth` with
  explicit recovery copy.

**Open beads this plan absorbs or sequences:**
- `cave-gwyw` — iOS connect screen scans QR inline (AVCaptureMetadataOutput);
  golden path 5 phase 3. → becomes part of Thread 1 phase 1.
- `cave-vcyh.1` — iOS ATS `NSAllowsArbitraryLoads=true` review. → Thread 2
  hygiene item.

---

## Thread 1 — iOS onboarding overhaul

### The central architectural fact (reviewed 2026-07-09)

Two pairing trust models coexist, and **the UI drives the wrong one for
packaged users**:

1. **Token model** (shipped #2320): signed `v1.*` invites, `covencave://`
   deep link, Bearer everywhere, 30-day rolling refresh that also records the
   "Paired · last seen" beat. Server + iOS support is COMPLETE — but the
   UI branch that mints these invites (`mobileHandoff()`,
   `mobile-handoff/route.ts:303-399`) is **orphaned**: all three desktop
   entry points (top-bar, chat "Continue on phone", Settings card) POST
   `action:"app-start"` instead, whose QR carries **no credential**.
2. **Tokenless tailnet-trust** exists only as a dev-script flag
   (`TAILNET_TRUST`, `pnpm mobile:tailscale:app`); `proxy.ts:186-196` states
   the packaged app never sets it.

### Friction inventory (ranked)

1. **P0 — packaged app cannot pair at all.** In bundle mode `app-start`
   requires a tokenless dev server on :3000 (`route.ts:130-182`) — i.e. a
   dev checkout and a pnpm command. The humanized error even misclassifies
   the 401 as "Tailscale Serve couldn't start" (`settings-shell.tsx:1979-84`
   matches "server" against `includes("serve")`). No bead tracked this.
2. **P0 — Tailscale is assumed, never guided** (two installs, two sign-ins,
   MagicDNS/HTTPS settings; neither side detects absence or explains why a
   desktop is required).
3. **P0 — the re-pair loop can't heal.** `.needsAuth` copy says "scan the
   QR" but the app-start QR carries no token — scanning 401s again. Only a
   CLI invocation can mint a token invite today.
4. **P1** — "one scan" doesn't auto-connect natively (tokenless QR only
   fills the host field); the paired signal (`lastSeenAt`) can never fire on
   the flow the UI drives; Settings "Copy link"/"Copy app link" buttons are
   dead (field mismatch with app-start responses); modal copy is
   plumbing-speak ("Reset Serve", "Refresh route").
5. **P2** — the native scanner drops `#chat-<id>` fragments
   (`CaveInvite.swift:29-33`), silently degrading Continue-on-phone to
   "open the app"; happy-path step count ≈ 6-7 actions (+4-6 without
   Tailscale preinstalled).

**Stale artifacts found:** `cave-gwyw` specs an in-app QR scanner that
already shipped (#2320, VisionKit `DataScannerViewController`);
`golden-paths.md` §5 item 3 asserts "no in-app scan" — stale;
`mobile-tailscale-native.md:18` claims ATS arbitrary loads are disabled —
contradicts `Info.plist:64` (see cave-vcyh.1).

### Overhaul phases

**Phase O1 — un-orphan the token model (smallest coherent fix; ~80%
wiring).** In bundled mode, `app-start` publishes the sidecar itself through
Serve and returns the signed payloads `mobileHandoff()` already mints: the QR
becomes a tokened invite (Safari works via the existing cookie exchange; the
native scanner auto-connects via existing `CaveInvite` parsing; Bearer passes
the sidecar gate). Kill the dev-checkout dependency; keep tokenless as the
dev-script mode. This automatically fixes frictions 3/4 (QR heals needsAuth,
scan auto-connects) and the paired signal (refresh → lastSeenAt), revives the
dead Copy buttons, and the error-copy mappings get fixed in passing. Files:
`mobile-handoff/route.ts`, `mobile-handoff.ts`, `settings-shell.tsx`,
`mobile-handoff-modal.tsx`, both handoff test files.

**Phase O2 — prerequisite & error journey.** The Phone card becomes a guided
checklist (Tailscale installed → running → signed in → route live → phone
seen) driven by probes the route already runs, plus an install-the-app QR;
iOS explains the model ("your Cave lives on your desktop"), deep-links the
Tailscale install, and gets progressive unreachable diagnostics; copy pass
per the design language; refresh the stale mobile docs.

**Phase O3 — zero-QR pairing (product calls first).** "Approve this phone"
(phone POSTs a pairing request, desktop toast Approve/Deny mints the 30-day
token, phone polls); optional Bonjour/mDNS same-LAN discovery; optional
iCloud Keychain (`kSecAttrSynchronizable`) token survival.

**Phase O4 — lifecycle & distribution.** ATS decision (cave-vcyh.1); native
`#chat-<id>` fragment handling (absorbs the useful remnant of cave-gwyw);
TestFlight CI lane; desktop-asleep guidance.

### Open questions (Thread 1)

1. Pick ONE trust model for packaged users (token works end-to-end today;
   tokenless-tailnet is the docs' ideal but needs packaged-server work +
   security review).
2. Is Tailscale a hard prerequisite, or must a same-LAN no-Tailscale path
   exist? (Drives Bonjour + the ATS answer.)
3. TestFlight-only vs App Store (App Store forces the ATS resolution).
4. Should phone pairing join the desktop onboarding wizard (absent today)?
5. iCloud Keychain credential sync — convenience vs device-bound?
6. What does the ONE QR encode — Safari-first or native-first?
7. Multi-desktop support in scope? (`CaveConnection` is single-host.)

## Thread 2 — seamless, constant connection

### Transport today (reviewed 2026-07-09)

iPhone → Tailscale tailnet HTTPS (`*.ts.net`) → `tailscale serve` on the Mac →
loopback `127.0.0.1:3000` → the custom Next server. The server deliberately
binds loopback only (`server.ts:454`; the pty upgrade hard-rejects
non-loopback peers). Two trust modes exist in parallel: token-gated (signed
`v1.<exp>.<nonce>.<sig>` tokens, 30-day rolling refresh,
`mobile-access-token.ts` / `mobile-token-refresh.ts`) and tokenless
`TAILNET_TRUST` (dev script only). The iOS client already has serious
resilience: dedicated URLSessions (24h stream resource cap), transparent
GET retries, NWPathMonitor + foreground probes, 4-attempt connect backoff,
concurrent port-candidate discovery with 401-is-terminal adjudication, an
offline compose queue with server-transcript dedupe, and post-hoc
`resyncInterruptedTurn` recovery. Server side: SSE `: hb` heartbeats every
20s, abort≠cancel with a 10-min detach cap so replies finish and persist,
PTY detach grace 300s with 256KB scrollback replay.

### The failure that dominates everything else

**The packaged desktop app mints a fresh access-token secret on every launch**
(`src-tauri/src/lib.rs:480-484` → `:1075`; never persisted). Every previously
signed phone token fails signature after any desktop restart → `.needsAuth` →
"Your pairing has expired… scan the QR". The dev script persists its secret
(`scripts/mobile-tailscale.sh:329-340`) and doesn't have this problem. This
single bug converts routine restarts into forced re-pairing and is the
root of the "constant connection" complaint.

Other failure modes (cause → experience → self-heal):

| Cause | User experience | Self-heal |
|---|---|---|
| Desktop restart (packaged) | forced re-pair | **never** (the bug above) |
| Desktop asleep | whole app replaced by Connect screen; cached context hidden | only when Mac wakes; ≤10s after |
| Phone backgrounded | usually invisible (resync + PTY grace ≤5min) | seconds after foreground |
| Network switch | at worst a bubble flickers | seconds |
| Server restart mid-stream | red error bubble; Retry re-runs | reconnect heals; the turn doesn't |
| Dev port fallback (3000→3001) | unreachable — serve points at the old port; phone doesn't probe 3001-3010 | no |
| Token idle >30d | re-scan QR | by design |

### Roadmap (smallest first)

**Phase C0 — stop losing pairings and context (days).**
(1) Persist the packaged app's mobile secret across launches (load-or-create
in app data; mirror the dev script; keep the per-launch sidecar token
separate). (2) Honest reconnect UX: once surfaces have loaded, keep
`MainTabView` mounted with a "Reconnecting… last seen 2m ago" pill instead of
tearing down to the Connect screen (`RootView.swift:10-19`); full-screen only
for `.unconfigured`/`.needsAuth`. (3) Widen bare-host discovery to 3000-3010
(`CaveConnection.swift:78`) to match the server's port fallback.

**Phase C1 — one reconnection state machine (a week).** Consolidate the four
overlapping recovery triggers (path monitor, foreground probe, 10s ticker,
auto-recover cooldown) into a single supervisor with jittered backoff and a
`degraded` state; local notification + toast on reconnect. Add a
BGAppRefreshTask to ping + roll the token refresh while backgrounded.

**Phase C2 — stream resumability.** Recovery today is post-hoc (the reply
appears only once the turn *ends*). Buffer stream events per run server-side
(ring buffer, like PTY scrollback) and expose a resume cursor
(`Last-Event-ID` or `GET /api/chat/stream?runId&cursor`); iOS re-attaches to
the LIVE run. Re-attach cancels the detach kill (PTY `adoptSession` pattern).

**Phase C3 — keep the desktop reachable.** Prevent-sleep power assertion
while phones are paired (opt-in, default off; AC-only by default); optional,
default-off LaunchAgent daemon mode so the server outlives the app
(`uninstall-app.sh` unloads the agent before removing its paths); serve/port
self-repair on port fallback. Wake-on-LAN is NOT feasible over Tailscale:
the userspace WireGuard daemon sleeps with the Mac, while Bonjour sleep proxy
is limited to local-network mDNS.

**Phase C4 — background reachability (product call first).** Real background
push requires APNs — a vendor-cloud departure. Everything through C3 is
vendor-free; Live Activities + reconnect notifications are the vendor-free
ceiling.

### Open questions (Thread 2)

1. APNs vs no-vendor-cloud stance (gates C4).
2. Daemonize the server (LaunchAgent) — opt-in toggle or default?
3. Prevent-sleep policy: on-AC-only? user toggle?
4. Converge on signed-tokens-always and delete `TAILNET_TRUST` (two parallel
   gate implementations today: `proxy.ts` + duplicated in `server.ts`)?
5. Where does the persisted desktop secret live — app-data file or Keychain?
   (Rotating it = "un-pair all devices", which is also a feature.)
6. Sequencing vs the travel/hub architecture (`maybeQueueOfflineChat`,
   `travel-local` authority) — an always-on hub may obsolete parts of C3.

## Thread 3 — cloud persistence as backup

### State inventory (reviewed 2026-07-09; live `~/.coven` ≈ 4.4 GB, backup payload ≈ 15–50 MB)

**Tier 1 — irreplaceable user data (the payload):** conversations
(`cave-conversations/<id>.json`, 13 MB — private chats, HIGH sensitivity),
board / inbox / canvas / state / config JSONs, projects + permissions,
familiars.toml + tombstones, memory (`~/.coven/memory/` + per-familiar
workspace `memory/` carve-outs + `archival.sqlite3`), journal
(`journal/<date>.md`), grimoire knowledge, library, prompts, skills, roles,
workflows, flows, run histories, identity files.

**Tier 2 — secrets (must never travel in plain form):** the encrypted vault
(`cave/local-vault.enc.json`, AES-256-GCM per secret) — but its raw key
(`cave/local-vault.key`) sits NEXT to the ciphertext, so a naive `~/.coven`
backup ships key+ciphertext together = plaintext-equivalent. Plus legacy
plaintext `cave/.env.local`. **This is the central design constraint.**
`cave-config.json` is semi-secret too: `multiHost.hubUrl` may embed a signed
access token in the URL.

**Tier 3 — excludable:** the daemon DB (`coven.sqlite3`, 461 MB — needs
`sqlite3 .backup`/`VACUUM INTO` if ever included; the app boots fine without
it), workspaces (3.8 GB of re-cloneable repos, minus the memory carve-outs),
logs/sockets/locks/archives.

**Gap:** browser-profile state (avatar/backdrop IDB images, localStorage
prefs) is on no disk path a backup would see — accept loss in phase 1.

### What exists today: effectively nothing

No export/import endpoints, no settings card, no cloud integration anywhere.
iOS has a chat-threads-to-markdown-zip share sheet; that's the entire story.
Crash-safety is partial: board/config write atomically, **inbox and
conversations use plain `writeFile`** (torn-write risk — independent fix).
The travel offline queue is hub-replay, not sync; iOS has no offline read
cache (blind when the desktop is down).

### Architecture: snapshot-first, hub-aware later

- **(a) Encrypted snapshot → user-owned storage — recommended core.**
  Allowlisted Tier-1 tar + passphrase envelope (scrypt + AES-256-GCM, all
  in-house primitives); destinations: local file → iCloud Drive folder (zero
  credentials, ideal macOS default) → user-keyed S3/R2 later. Restore: fresh
  machine → "Restore from backup" → passphrase → unpack → restart daemon.
  Secrets travel only inside the envelope (or are excluded and re-entered —
  there are ~2-6 of them). Effort: small.
- **(b) Git-mirror of `~/.coven`** — rejected as product: one `.gitignore`
  mistake permanently leaks a PAT to a remote; document as DIY only.
- **(c) CRDT live sync** — right long-term shape for multi-machine + iOS
  offline reads; heavy; defer, but version the snapshot format so it can
  seed this later.
- **(d) Hub-as-durable-home** — composes with the EXISTING
  `multiHost.mode: local|hub` plumbing (`coven-daemon.ts:111-124`, settings
  UI already shipped): daemon on an always-on box makes state durable AND
  gives iOS a target when the desktop sleeps — the strongest answer to
  "phone keeps working". It's availability, not backup (the hub itself needs
  (a)); position as optional composition, not prerequisite.

### Roadmap

**Phase P0 — hygiene (independent wins, days):** atomic writes for
`cave-inbox.ts` + `cave-conversations.ts` (use the existing
`atomic-write.ts`); stop persisting the hub token inside `hubUrl`.

**Phase P1 — manual export/restore:** `backup-manifest.ts` (allowlist +
excludes + secrets policy) and `backup-archive.ts` (tar + envelope, versioned
header); `/api/backup/export` + `/api/backup/restore` (⚠ api-contracts
alphabetical list); `scripts/cave-backup.mjs` for cron/headless; a Settings
"Backup" card; a restore entry in onboarding for fresh machines.

**Phase P2 — scheduled encrypted sync:** daily + on-quit snapshot push to
the chosen destination (iCloud folder first — no credentials; S3/R2 behind
user keys stored in the existing vault); retention of N snapshots;
freshness surfaced in Settings.

**Phase P3 — availability:** harden/document hub mode as the durable home;
iOS read-only cache seeded from last-known data (separate, larger effort).

### Open questions (Thread 3)

1. Key custody: **decided 2026-07-15 — include, passphrase-wrapped.** The
   vault key travels inside the encrypted backup envelope so one backup
   passphrase restores the vault and stored PATs/tokens. Plaintext secrets must
   never appear outside that envelope.
2. Storage stance: strictly user-owned destinations, or is a first-party
   hosted option ever acceptable?
3. Daemon DB in scope? (461 MB vs 15-50 MB; transcripts survive without it.
   Suggest optional toggle, default off.)
4. Is two-machines-active a near-term requirement (pushes toward (c)/(d))?
5. Runtime memory outside `~/.coven` (`~/.openclaw`, `~/.codex`) — in scope
   or the harnesses' problem?
6. Should backup scrub/rotate the `hubUrl` token (and should it stop living
   in a URL at all — see P0)?

---

## Sequencing & beads

Principles: phase-0s are small, independently shippable, and unblock the
threads' biggest pains (persisted desktop secret; atomic writes). The three
threads are largely parallel; the deliberate couplings are (1) onboarding's
re-pair story becomes trivial once C0 lands, and (2) restore-from-backup
becomes an onboarding entry point once P1 lands.

Umbrella: **cave-rku9**. `cave-gwyw` was closed as stale (the scanner it
specced shipped in #2320); its useful remnant (fragment handling) lives in O4.

| Order | Bead | Item | Thread | Effort |
|---|---|---|---|---|
| 1 | `cave-y482` (P1) | C0 — persist packaged-app mobile secret + reconnect pill + port range | connection | days |
| 1 | `cave-gzje` (P1) | O1 — un-orphan the signed-invite token model (packaged pairing works at all) | onboarding | days-week |
| 1 | `cave-1v95` (P2) | P0 — atomic writes (inbox, conversations) + hubUrl token de-embedding | persistence | days |
| 2 | `cave-jr4r` | O2 — guided prerequisite + error journey + stale-docs refresh | onboarding | ~week |
| 2 | `cave-166o` | P1 — manual encrypted export/restore + Settings card + onboarding restore | persistence | ~week |
| 3 | `cave-j1bo` | C1 — one reconnection supervisor + BGAppRefreshTask | connection | ~week |
| 4 | `cave-h40l` | C2 — live stream resume cursors | connection | ~week+ |
| 4 | `cave-clyh` | P2 — scheduled encrypted sync (iCloud folder first) | persistence | ~week |
| 5 | `cave-xs4m` | C3 — prevent-sleep / LaunchAgent / serve self-repair | connection | product calls |
| 5 | `cave-r1h6` | O3 — zero-QR pairing (approve-this-phone, Bonjour, iCloud Keychain) | onboarding | product calls |
| 5 | `cave-f1wo` | O4 — ATS (w/ cave-vcyh.1), #chat fragment, TestFlight CI | onboarding | product calls |
| 6 | umbrella | C4/P3 — APNs, hub-as-durable-home, iOS offline read cache | both | product calls |

Dependencies wired in bd: O2←O1, O3/O4←O2, C1←C0, P1←P0, P2←P1.

**Coordination note:** a `feat/automatic-onboarding-bootstrap` worktree exists
from another session (uncommitted scaffolding only: .gitignore, package.json,
pnpm-lock; branch tip = already-merged #2890; no PR, no bead found). Before
starting Thread 1 implementation, check whether that session is actively
building an onboarding bootstrap and reconcile.

<!-- SYNTHESIS SLOT: sequencing-final -->
