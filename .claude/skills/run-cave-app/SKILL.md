---
name: run-cave-app
description: Launch the Coven Cave app (Next.js web build) and drive a real browser to any surface — Home, Chat, Board, Canvas (Triage/Sketch), Calendar, Library, etc. — taking screenshots. Use when asked to run/start/show/screenshot the app or verify a UI change in the real app. Browser-driven via Playwright; no daemon required (demo mode supplies data).
---

# Running the Coven Cave app

Cave is a Next.js app served by a custom Node server (`server.ts` → bundled `server.mjs`), also packaged as a Tauri desktop app. To *see a surface*, run the web server and drive it with Playwright/chromium (both already installed: `@playwright/test`). **Do not** screenshot a blank frame and call it done — look at the image.

## 0. Work in a throwaway worktree, never the primary checkout

The primary checkout often has another live session's uncommitted work and concurrent git ops. Build/run from a fresh worktree on a unique port.

**Use a session-UNIQUE worktree name, and make `add` fail-fast.** Fixed names like `run-tmp`/`verify-*` collide with other live sessions doing the same thing. The dangerous part isn't the collision itself — it's that when `git worktree add` fails (`'.worktrees/<name>' already exists`) a naive script *keeps going* and `cd`s into the pre-existing directory, which may be **another session's dirty worktree**, and then builds/serves from it. Guard against every collision vector:

- **Unique name** (`$RANDOM$RANDOM`) so clashes are near-impossible.
- **`prune` first** to clear stale admin entries left by crashed runs.
- **Confirm the path is free** before adding (a leftover dir from a crash blocks `add`).
- **Treat `add` as fatal** — abort the whole run if it fails; never fall through to `cd`.
- **`cd` ONLY into the path `add` just created**, and sanity-check `HEAD`.

```bash
MAIN=/Users/buns/Documents/GitHub/OpenCoven/coven-cave
git -C "$MAIN" worktree prune                        # drop stale entries from crashed runs
# Pick a name that is neither an existing dir nor a registered worktree.
WT=""; for _ in 1 2 3 4 5; do
  cand="run-$RANDOM$RANDOM"
  [ -e "$MAIN/.worktrees/$cand" ] && continue
  git -C "$MAIN" worktree list --porcelain | grep -q "/.worktrees/$cand\$" && continue
  WT="$cand"; break
done
[ -n "$WT" ] || { echo "could not find a free worktree name — aborting"; exit 1; }
# --detach for read/measure (no branch); use -b "$WT" only if you'll commit.
git -C "$MAIN" worktree add --detach "$MAIN/.worktrees/$WT" origin/main \
  || { echo "worktree add failed for $WT — ABORT (do NOT cd into a pre-existing dir)"; exit 1; }
cd "$MAIN/.worktrees/$WT" || exit 1
git rev-parse --short HEAD                            # sanity: this is YOUR fresh worktree
pnpm install                                         # ~6s (pnpm CAS)
```

Every later step keys off `$WT` (server log `/tmp/cave-$WT.log`, `pkill -f "$WT/server.mjs"`, cleanup `git worktree remove ".worktrees/$WT"`), so nothing ever touches another session's worktree.

## 1. Build (required — dev mode needs Tauri; prod server is simplest)

```bash
pnpm build      # next build + build:server (server.mjs) + prebuild (icons, PWA, sandbox/*.js)
```

`prebuild` runs `scripts/build-sandbox-runtime.mjs`, which emits `public/sandbox/react-runtime.js` + `tailwind.js` — **required for the Canvas Sketch React/Tailwind previews**. They're gitignored, so a fresh checkout must build before Sketch React tiles render.

## 2. Run the server on a unique port

**Clear the stale Next dev singleton lock first.** `node server.mjs` aborts with *"Another next dev server is already running"* if a previous server was killed without cleaning `.next/dev` — a very common failure after a `pkill`. Always `rm -rf .next/dev` before starting. Pick a unique port too (a fixed `3300` collides with other sessions' servers).

```bash
rm -rf .next/dev                                    # drop any stale singleton lock
pkill -f "$WT/server.mjs" 2>/dev/null || true       # kill a prior server for THIS worktree only
PORT=$((3300 + RANDOM % 500))                        # unique-ish; avoids cross-session port clashes
PORT=$PORT node server.mjs > "/tmp/cave-$WT.log" 2>&1 &
# Boot takes ~5–15s (Next prepare). POLL — don't fixed-sleep:
until curl -s -m3 -o /dev/null "http://127.0.0.1:$PORT/api/canvas"; do sleep 2; done
echo "up on $PORT"
```

**Background/lifecycle gotcha:** start the server with a trailing `&` inside a *normal* Bash call (it stays alive, disowned to the session). Do **not** launch it via the tool's `run_in_background` with a trailing `&` — the outer command returns immediately and the backgrounded child gets reaped, so the server dies before you can drive it. If you want it in `run_in_background`, run `node server.mjs` as the task's *foreground* process (no `&`).

- **Access gate**: `server.ts` only enforces token auth when `COVEN_CAVE_ACCESS_TOKEN` is set. Plain loopback (`127.0.0.1`) requests are open — no token needed. (The gate in `server.ts` is for the `/api/pty-ws` WebSocket upgrade only; HTTP is ungated locally.)
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
// .worktrees/run-tmp/__shoot.mjs   (delete after)
import { chromium } from "@playwright/test";
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
await ctx.addInitScript(() => {
  localStorage.setItem("cave:onboarding:dismissed", "1");
  localStorage.setItem("cave:canvas:layer", "triage"); // or "sketch" — Canvas-only
});
const page = await ctx.newPage();
await page.goto("http://127.0.0.1:3300/?demo=1", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);
await page.evaluate(() => window.dispatchEvent(new CustomEvent("cave:navigate-mode", { detail: { mode: "canvas" } })));
await page.waitForSelector(".canvas-view", { timeout: 8000 });
await page.waitForTimeout(1200);
await page.locator(".react-flow__controls-fitview").click().catch(() => {});
await page.waitForTimeout(1500);
await page.screenshot({ path: "/tmp/cave.png" });
await b.close();
```
Run: `node ./__shoot.mjs` (from the worktree dir). Then `Read /tmp/cave.png`.

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

## 3.5 Seeding into a REAL store — BACK UP FIRST (non-negotiable)

Surfaces read live data from `~/.coven/*` (journal, board/`cave-board.json`, inbox, canvas/`cave-canvas.json`, …). If you POST to seed a record so a feature has something to show, you can **silently overwrite a real record** — and most of these stores have **no undo/history** (the journal is one file per day; a bad POST is unrecoverable). This has bitten before (overwrote a real journal entry, couldn't restore it — see memory `feedback_backup_before_overwriting_data_stores`).

Rules before any seeding POST:

1. **Prefer a throwaway key** that can't collide with real data (e.g. a clearly-fake past date `2000-01-01`, an obviously-fake id). Then no restore is needed — just delete it.
2. **If you must use a live key** (e.g. "today"), `GET` it and **save the full body to a file FIRST**, and only overwrite if it didn't already exist:
   ```bash
   TODAY=$(node -e "const d=new Date(),p=n=>String(n).padStart(2,'0');console.log(`${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`)")
   curl -s "http://127.0.0.1:$PORT/api/journal?date=$TODAY" -o /tmp/seed-backup.json
   node -e "process.exit(require('/tmp/seed-backup.json').exists?0:1)" \
     && echo "REAL ENTRY EXISTS — do NOT overwrite; use a throwaway date instead" \
     || curl -s -X POST .../api/journal -d '{"date":"'$TODAY'",...}'   # safe: nothing was there
   ```
   Treat **every `exists:true` as precious** — ~10 concurrent sessions share these stores, so "looks like a leftover seed" may be someone's real data.
3. **Restore/clean in step 4**: if a backup existed, re-POST it; if you seeded where nothing existed, DELETE your seed so no fabricated content is left behind.

## 4. Clean up (always)

```bash
pkill -f "$WT/server.mjs" 2>/dev/null || true
# Restore any store you seeded: if a backup existed, re-POST /tmp/seed-backup.json's record;
# if there was NO prior store, DELETE your seed (leave nothing fabricated behind):
rm -f "$HOME/.coven/cave-canvas.json"     # only if it didn't exist before you seeded
# (journal/board/inbox: DELETE your seeded key, or re-POST the backup you saved in 3.5)
# Remove ONLY your own uniquely-named worktree — never another session's. Refuse
# if $WT is somehow empty (an unguarded `rm .worktrees/` would nuke every
# session's worktree).
[ -n "$WT" ] || { echo "WT unset — refusing to remove worktrees"; exit 1; }
cd "$MAIN"
git worktree remove --force ".worktrees/$WT" 2>/dev/null || rm -rf ".worktrees/$WT"
git branch -D "$WT" 2>/dev/null || true             # only if you used -b (not --detach)
git worktree prune
git worktree list                                   # verify: only your $WT is gone
```

**Never** `git worktree remove` a path you didn't create, and never bulk-remove `.worktrees/*` — other live sessions keep active, dirty worktrees there (removing one loses their unpushed work). If your own `remove` fails because the tree is dirty, investigate — a clean throwaway shouldn't be dirty; if it is, you're likely pointed at the wrong (foreign) worktree.

## Gotchas
- React 19 has no UMD → the Sketch React preview uses a bundled runtime in `public/sandbox/` (React + sucrase) + `@tailwindcss/browser`; all offline. Must be built (step 1) or React tiles blank.
- Preview iframes are `sandbox="allow-scripts"` with **no** `allow-same-origin`; they still load `/sandbox/*.js` from our origin.
- Tailwind v4 computes colors in **oklch**, not rgb — assert accordingly when checking styles.
- Server "Ready on…" in the log can precede actual readiness by a second or two — poll the HTTP endpoint, don't trust the log line alone.
- Even after the server answers, the FIRST request to each API route is slow (cold compile/warm-up) — probe data-dependent UI with `waitForFunction` on the data itself, not fixed sleeps (see "Wait for DATA, not time" in step 3). This has produced false "feature broken" verdicts.
- A second `pnpm dev`/server on port 3000 collides — always use a unique PORT.
- `node server.mjs` fails with *"Another next dev server is already running"* when a prior server left a stale `.next/dev` lock. `rm -rf .next/dev` before starting (step 2).
- **Measuring top-bar elements:** the app renders TWO menubars — the desktop `.menu-bar` (`FamiliarMenuBar`, shown ≥1024px) and the mobile `.top-bar` (shown ≤1023px); only one is visible per viewport but BOTH can be in the DOM. `querySelector` may return the hidden one (0×0 rect). Select the VISIBLE instance: `[...document.querySelectorAll(sel)].find(el => el.getBoundingClientRect().width > 0)`. Some top-bar buttons also report 0×0 themselves — measure a leaf child (e.g. the icon `<svg>`) for a real box. Verify UI that lives in a menubar at the width where that menubar actually shows (desktop ≥1024, mobile ≤1023).
