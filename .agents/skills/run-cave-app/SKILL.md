---
name: run-cave-app
description: Launch the Coven Cave app (Next.js web build) and drive a real browser to any surface — Home, Chat, Board, Canvas (Triage/Sketch), Calendar, Library, etc. — taking screenshots. Use when asked to run/start/show/screenshot the app or verify a UI change in the real app. Browser-driven via Playwright; no daemon required (demo mode supplies data).
---

# Running the Coven Cave app

Cave is a Next.js app served by a custom Node server (`server.ts` → bundled `server.mjs`), also packaged as a Tauri desktop app. To *see a surface*, run the web server and drive it with Playwright/chromium (both already installed: `@playwright/test`). **Do not** screenshot a blank frame and call it done — look at the image.

## 0. Use an owned worktree, never the primary checkout

The primary checkout often has another live session's uncommitted work and concurrent Git operations. Reuse an explicitly authorized owned verification unit, or create a fresh throwaway worktree on a unique port. A throwaway run needs no issue record, but still counts toward the 28-worktree budget; inspect [GitHub work tracking](../../../docs/workflows/github-work-tracking.md#worktrees) before allocation.

Use a session-unique name and make creation fail-fast. A failed add must never fall through into a directory belonging to another session. Inspect capacity immediately before creation; raw Git does not enforce the budget, and missing paths or old registrations do not authorize pruning.

```bash
set -euo pipefail
CAVE_PRIMARY=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")
git -C "$CAVE_PRIMARY" fetch --no-prune origin main
CAVE_RUN_COUNT=$(git -C "$CAVE_PRIMARY" worktree list --porcelain | awk '/^worktree / { n++ } END { print n+0 }')
[ "$CAVE_RUN_COUNT" -lt 28 ] || { echo "worktree budget reached; preserve units and resolve capacity"; exit 1; }
CAVE_RUN_BASE=$(git -C "$CAVE_PRIMARY" rev-parse refs/remotes/origin/main)
WT=""; for _ in 1 2 3 4 5; do
  cand="run-$RANDOM$RANDOM"
  [ -e "$CAVE_PRIMARY/.worktrees/$cand" ] && continue
  [ -L "$CAVE_PRIMARY/.worktrees/$cand" ] && continue
  git -C "$CAVE_PRIMARY" worktree list --porcelain | grep -Fqx "worktree $CAVE_PRIMARY/.worktrees/$cand" && continue
  WT="$cand"; break
done
[ -n "$WT" ] || { echo "could not find a free worktree name; aborting"; exit 1; }
git -C "$CAVE_PRIMARY" worktree add --no-track --detach "$CAVE_PRIMARY/.worktrees/$WT" "$CAVE_RUN_BASE" \
  || { echo "worktree add failed; do not enter an existing directory"; exit 1; }
cd "$CAVE_PRIMARY/.worktrees/$WT"
[ "$(git rev-parse HEAD)" = "$CAVE_RUN_BASE" ] || exit 1
pnpm install --frozen-lockfile
```

Retain this run's exact worktree path, HEAD, server session handle and log path. A matching process-name pattern or a familiar-looking directory is not ownership proof. Stop at the budget and resolve capacity through [branch-curator](../branch-curator/SKILL.md); do not remove another unit to make room.

## 1. Build the production artifact

```bash
pnpm build      # next build + build:server (server.mjs) + prebuild (icons, PWA, sandbox/*.js)
```

`prebuild` runs `scripts/build-sandbox-runtime.mjs`, which emits `public/sandbox/react-runtime.js` + `tailwind.js` — **required for the Canvas Sketch React/Tailwind previews**. They're gitignored, so a fresh checkout must build before Sketch React tiles render.

## 2. Run the server on a unique port

Use production mode to serve the artifact from step 1. `server.ts` selects development mode unless `NODE_ENV=production`, and its port resolver prefers `COVEN_CAVE_PORT` over `PORT`; set both port variables to this run's selected value. Inspect any existing Next dev lock before starting. If it belongs to a live or uncertain writer, preserve it and use a different authorized unit. Clear only this run's proven stale generated lock state; a lock error alone does not authorize a recursive delete or a broad process kill.

```bash
CAVE_RUN_PORT=$((3300 + RANDOM % 500))
NODE_ENV=production COVEN_CAVE_PORT=$CAVE_RUN_PORT PORT=$CAVE_RUN_PORT node server.mjs
```

Keep the server attached to a terminal/tool session and retain its handle. Poll the exact loopback origin from a separate session until the intended API responds; do not infer readiness from elapsed time or a log line. Stop only the server session created by this run when verification ends.

- **Access gates**: `server.ts` marks verified direct-loopback peers before dispatching HTTP requests, and `src/proxy.ts` applies the request gates. WebSocket upgrades have their own checks. Verify the observed loopback origin and its API response before using it; a listening port alone does not establish readiness or access.
- **Data without a daemon**: most surfaces read JSON straight from `~/.coven/*.json` (no daemon). Add `?demo=1` to seed curated in-memory demo data (`DEMO_BOARD_CARDS`, demo familiars) for a clean, dependency-free view.

## 3. Drive with Playwright (run the script from INSIDE the worktree so `@playwright/test` resolves)

Key moves:
- **Suppress onboarding**: `localStorage["cave:onboarding:dismissed"]="1"` via `addInitScript` (runs before page scripts).
- **Jump to a surface**: after load, `window.dispatchEvent(new CustomEvent("cave:navigate-mode",{detail:{mode:"<mode>"}}))`.
- **Wait** with `waitUntil:"domcontentloaded"` (NOT networkidle — the app holds connections open).
- **Wait for DATA, not time.** A fresh prod server's FIRST hit on an API route can take seconds (route compile/warm-up), so data-dependent UI renders its empty/loading state first — a fixed `page.waitForTimeout(...)` probe reads that and reports a FALSE NEGATIVE ("feature broken" when it's just cold). Assert on the data being present:
  ```js
  await page.waitForFunction(() => {
    const sel = document.querySelector('.some-surface select');
    return sel && sel.options.length > 0 && sel.value !== "";
  }, { timeout: 20000 });
  ```
  Optionally prewarm with `curl` to the API route(s) before driving the browser.
- **Frame canvas/graph nodes**: click `.react-flow__controls-fitview` after switching, then screenshot.

```js
// ./__shoot.mjs in this run's owned worktree (retain or remove only this file after use)
import { chromium } from "@playwright/test";
const caveOrigin = process.env.CAVE_RUN_ORIGIN;
if (!caveOrigin) throw new Error("Set CAVE_RUN_ORIGIN to this run's observed loopback origin");
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
await ctx.addInitScript(() => {
  localStorage.setItem("cave:onboarding:dismissed", "1");
  localStorage.setItem("cave:canvas:layer", "triage"); // or "sketch" — Canvas-only
});
const page = await ctx.newPage();
await page.goto(new URL("/?demo=1", caveOrigin).href, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);
await page.evaluate(() => window.dispatchEvent(new CustomEvent("cave:navigate-mode", { detail: { mode: "canvas" } })));
await page.waitForSelector(".canvas-view", { timeout: 8000 });
await page.waitForTimeout(1200);
await page.locator(".react-flow__controls-fitview").click().catch(() => {});
await page.waitForTimeout(1500);
await page.screenshot({ path: "/tmp/cave.png" });
await b.close();
```
Run: `CAVE_RUN_ORIGIN="http://127.0.0.1:$CAVE_RUN_PORT" node ./__shoot.mjs` from the owned worktree, using the actual observed port. Then inspect `/tmp/cave.png`.

### Surface mode identifiers (`cave:navigate-mode` detail.mode)
`home` · `chat` · `board` · `canvas` · `calendar` · `inbox` (Schedules) · `library` · `browser` · `terminal` · `code` · `github` · `roles` · `workflows` · `capabilities`

### Canvas specifics
- Two layers via a toolbar segmented control / `localStorage["cave:canvas:layer"]` = `"triage"` | `"sketch"`. Bands render in triage only.
- **Triage** shows board cards (demo: ~5 cards; real `~/.coven/cave-board.json`: all of them — demo is cleaner for screenshots).
- **Sketch** shows generated UI artifacts. Demo mode does NOT load artifacts (stays empty). To show live HTML/React tiles without generating, seed them via the API while the server runs (non-demo):
  ```js
  await fetch("http://127.0.0.1:3300/api/canvas", { method:"POST", headers:{"content-type":"application/json"},
    body: JSON.stringify({ artifact: { id:"demo-html", title:"Card", prompt:"…", code:"<!doctype html>…", kind:"html", createdAt:new Date().toISOString(), updatedAt:new Date().toISOString() } }) });
  // kind:"react" with `export default function App(){…}` renders via the sandbox runtime (Tailwind classes work).
  ```
  Artifacts persist to `~/.coven/cave-canvas.json`.

## 3.5 Seeding a real store

Surfaces read live data from `~/.coven/*`. Prefer an isolated synthetic Cave home or demo data. If a real-store fixture is necessary, use a disposable key and save the complete current response before any mutation. A familiar-looking record may belong to another session.

1. Choose a key that does not collide with existing user or test data. A historical date or fake ID is only a candidate, not proof of absence.
2. Require an authoritative successful read with `exists: false` before creating the fixture. Any failed request, invalid JSON, missing field or existing record stops the seed; never turn an error into an automatic POST. For a date-keyed journal, the read-only preflight is:

   ```bash
   : "${CAVE_RUN_PORT:?Set the observed loopback port for this run}"
   CAVE_SEED_DATE=2000-01-01
   CAVE_SEED_BACKUP=$(mktemp "${TMPDIR:-/tmp}/cave-seed-backup.XXXXXX")
   curl --fail --silent --show-error "http://127.0.0.1:$CAVE_RUN_PORT/api/journal?date=$CAVE_SEED_DATE" -o "$CAVE_SEED_BACKUP" || exit 1
   node -e 'const r=JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8")); if(r?.exists!==false) throw new Error("Existing or unverified record; choose another key");' "$CAVE_SEED_BACKUP" || exit 1
   ```

3. After that check, create only the named fixture through the store API and retain its request/read-back evidence. Do not overwrite a real record to make a screenshot.
4. At cleanup, remove only the fixture key created by this run through the same API and verify the resulting state. If separately authorized work modified an existing record, restore its exact saved content and read it back. Never remove the whole live store file as a shortcut.

## 4. Stop the run and complete guarded retirement

Stop the retained server session first and complete the store cleanup from section 3.5. Keep screenshots, logs and source/artifact identities needed for the handoff.

Run [branch-curator](../branch-curator/SKILL.md) before any worktree, registration or branch removal. It must select the authorized deletion profile, hold the required lease, revalidate the exact OID and owner/disposition, inspect tracked/untracked/ignored and recovery state, verify live remote retention, and obtain the strict worktree guard's allow result immediately before non-forced removal. A throwaway name or an ancestor of main is not a substitute for those proofs.

If the guard, retention query or removal fails, preserve the unit and its evidence and record its owner, exact path/HEAD, blocker and next step. Do not retry with force, fall back to deleting the directory, compare-delete a branch without its separate proof, or prune registration/reflog state to make cleanup pass. Re-inventory after any verified removal and report what was actually removed.

## Gotchas
- React 19 has no UMD → the Sketch React preview uses a bundled runtime in `public/sandbox/` (React + sucrase) + `@tailwindcss/browser`; all offline. Must be built (step 1) or React tiles blank.
- Preview iframes are `sandbox="allow-scripts"` with **no** `allow-same-origin`; they still load `/sandbox/*.js` from our origin.
- Tailwind v4 computes colors in **oklch**, not rgb — assert accordingly when checking styles.
- Server "Ready on…" in the log can precede actual readiness by a second or two — poll the HTTP endpoint, don't trust the log line alone.
- Even after the server answers, the FIRST request to each API route is slow (cold compile/warm-up) — probe data-dependent UI with `waitForFunction` on the data itself, not fixed sleeps (see "Wait for DATA, not time" in step 3). This has produced false "feature broken" verdicts.
- A second `pnpm dev`/server on port 3000 collides — always use a unique PORT.
- A Next dev singleton-lock error needs the ownership check in step 2; it is not permission to delete another session's lock or stop its server.
- **Measuring top-bar elements:** the app renders TWO menubars — the desktop `.menu-bar` (`FamiliarMenuBar`, shown ≥1024px) and the mobile `.top-bar` (shown ≤1023px); only one is visible per viewport but BOTH can be in the DOM. `querySelector` may return the hidden one (0×0 rect). Select the VISIBLE instance: `[...document.querySelectorAll(sel)].find(el => el.getBoundingClientRect().width > 0)`. Some top-bar buttons also report 0×0 themselves — measure a leaf child (e.g. the icon `<svg>`) for a real box. Verify UI that lives in a menubar at the width where that menubar actually shows (desktop ≥1024, mobile ≤1023).
