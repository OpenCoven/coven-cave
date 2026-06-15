# Hermes install button — background jobs, live progress, post-install flow

**Date:** 2026-06-12
**Status:** Approved design, pending implementation plan
**Surfaces:** `src/app/api/onboarding/install/route.ts`, `src/components/onboarding-overlay.tsx`

## Problem

The onboarding "Install Hermes" button runs the official NousResearch installer
server-side with a 10-minute timeout while the client awaits a single buffered
POST. Four confirmed pain points:

1. **No progress feedback** — the button shows a static "Installing…" for up to
   10 minutes; the install looks frozen.
2. **Blocks other installs** — `installBusy !== null` disables every install
   button while any one target runs.
3. **Post-install flow** — the user is told to run `hermes setup` in prose;
   there is no affordance.
4. **Visual design** — the busy state is indistinguishable from a hung UI; no
   spinner, no elapsed time, no output.

A page refresh mid-install also loses all knowledge of the running job even
though the installer keeps running server-side.

## Approach (chosen: A — background job + polling)

Convert the install route from request-scoped execution to a server-side job
registry polled by the client. Rejected alternatives: SSE streaming (fragile
across refresh, adds a transport to the access-gate surface, dev-proxy
buffering) and client-only polish (cannot show live output while the POST
buffers).

## Design

### 1. Server — job registry in the install route

- **Registry:** `Map<InstallTarget, InstallJob>` stored on `globalThis` (the
  established Next dev pattern, so HMR module re-evaluation does not orphan
  running jobs).
- **InstallJob:** `{ status: "running" | "done", startedAt: number,
  output: string (capped ring buffer, last ~8 KB, ANSI-stripped on read),
  ok?: boolean, code?: number | null, binaryPath?: string | null,
  error?: string }`.
- **POST `{target}`** (shape change):
  - Prechecks unchanged and synchronous in the response: target allowlist
    (400), npm-missing for npm-kind targets (422 + hint), no plan (500).
  - If a job for the target is already `running`: `200` with the same body
    shape as GET (idempotent re-POST; no duplicate spawn).
  - npm-kind mutual exclusion: if another npm-kind job is running, 409 with
    `error: "wait for <label> to finish"` — concurrent `npm install -g` calls
    race the global tree. Script-kind (Hermes) is exempt and runs alongside
    npm jobs.
  - Otherwise spawn (same fixed spawn plans, same `covenSpawnEnv`), record the
    job, return `202 { started: true, target }` immediately.
  - The existing per-target timeout (`SIGTERM` at `timeoutMs`) and the
    post-exit `which` verification move into the job's close handler; results
    land in the job record instead of an HTTP response.
- **GET `?target=<target>`** (new):
  - Running: `200 { status: "running", elapsedMs, tail }` (tail = stripped
    last ~2 000 chars).
  - Done: `200 { status: "done", ok, code, binaryPath, error?, tail,
    elapsedMs }`. Done jobs stay in the registry until a new POST for that
    target replaces them (so a refreshed client can still render the result).
  - No job: `200 { status: "idle" }`.
  - Unknown target: 400.
- **Security:** target allowlist unchanged; nothing user-controlled reaches a
  shell. No new transport — plain HTTP route, already behind the existing
  access gate.

### 2. Client — per-target job state + polling

- Replace `installBusy: InstallTarget | null` with
  `installJobs: Partial<Record<InstallTarget, JobView>>` where `JobView =
  { status: "running" | "done", elapsedMs, tail, result? }`.
- A single polling effect (interval ~2 s) runs while any job is `running`,
  fanning GETs per running target; it also fires once when the runtime step
  mounts so a mid-install refresh re-attaches to the server-side job.
- `runInstall(target)`: POST, then mark the target running and let the poller
  take over. `npmMissing` / 409 / hard errors keep today's result-note paths.
- Disable rules: a card's button disables only when **its own** target runs,
  or when the target is npm-kind and any other npm-kind job is running
  (mirror of the server's 409 so users rarely see it).
- On job completion: write the result into `installResults` (existing shape),
  call the existing `onRefresh` so the harness report re-checks and the card
  flips to its green "installed" state without a manual Refresh.

### 3. Button + progress UI (per card, Hermes shown; applies to all targets)

- **Idle:** unchanged (accent button, download icon, `Install <label>`).
- **Running:** spinner icon (existing `ph:` set — respect the `ICON_NAMES`
  whitelist) + `Installing… <m>m <s>s`, elapsed derived from the server's
  `startedAt` (client clock only formats deltas).
- **Live tail:** below the `CommandRow`, a 3-line monospace block styled like
  `CommandRow` (same hairline border, radius, mono size), showing the last
  lines of installer output, newest at the bottom. Present only while
  `running`; replaced by the result note when done.
- **Success (Hermes only):** a "Next step" block — `hermes setup` in a
  `CommandRow` with copy button plus the existing after-install note. One-click
  execution in the app terminal is explicitly out of scope: `BottomTerminal`
  is mounted in `comux-view`, not reachable from the overlay, and the plumbing
  isn't justified by this feature.
- **Failure:** existing `InstallResultNote` plus a `<details>` "Show full
  output" expandable with the final tail.

### 4. Error handling

- Server restart mid-job (not HMR — full process death): the orphaned job
  disappears with the process; GET returns `idle`, the client's re-attach poll
  clears the running state, and the harness Refresh tells the truth about
  whether the binary landed. Acceptable; no persistence layer for install jobs.
- Timeout, spawn error, nonzero exit, binary-missing-after-exit: same
  semantics as today, surfaced through the job record → result note.

### 5. Testing

- `route.test.ts`: POST returns 202 and registers a running job; re-POST while
  running is idempotent (no second spawn); GET reflects running → done with
  tail and verify result; npm-kind mutual exclusion 409s; script-kind runs
  alongside npm-kind; prechecks (allowlist 400, npmMissing 422) unchanged.
- `onboarding-guided-steps.test.ts` (source-level assertions, matching the
  file's existing style): per-target disable expression, elapsed-time label,
  live-tail block, `hermes setup` next-step row, re-attach poll on mount.
- Live verification: drive the dev app per the existing recipe — **mock the
  install route; never POST real install targets** (a real Hermes install
  mutates the machine and takes minutes).

## Out of scope

- One-click `hermes setup` in the app terminal (cross-surface plumbing).
- Persisting install jobs across server restarts.
- Cancel/abort button for a running install (the timeout covers runaways; can
  be added to the job model later if wanted).
