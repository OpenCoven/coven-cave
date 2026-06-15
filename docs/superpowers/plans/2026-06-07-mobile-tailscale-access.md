# Mobile Tailscale Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make CovenCave viewable from a phone over Tailscale with a private tailnet URL, documented setup, and mobile-specific verification.

**Architecture:** Run the existing Next.js browser surface on the developer machine and expose it privately through Tailscale Serve. Keep the Tauri desktop app local-only; mobile uses the Next.js web UI and talks back to the same local API routes on the host machine. Add a small repeatable script and docs so future mobile sessions do not depend on remembered shell commands.

**Tech Stack:** Next.js 16, pnpm, Tailscale Serve, MagicDNS, Playwright mobile viewport checks, existing Coven daemon/local storage.

---

## Current Repo Facts

- `package.json` exposes `pnpm dev`, `pnpm start`, and `pnpm dev:app`.
- `README.md` documents browser-only development at `http://localhost:3000`.
- `src-tauri/tauri.conf.json` points desktop dev at `http://localhost:3000`; this is not the mobile path.
- `src-tauri/capabilities/default.json` allows only `localhost` and `127.0.0.1` for Tauri remote capabilities, which is fine because mobile will not run Tauri APIs.
- Some browser-mode features intentionally no-op outside Tauri, such as the integrated native terminal and native notifications.
- API routes run on the host machine, so mobile requests can still reach host-local files, the Coven daemon socket, and local state through the Next server.

## Target User Experience

1. Val starts one command from the checkout.
2. The command starts or checks the Next server on port `3000`.
3. The command configures Tailscale Serve to proxy that local server.
4. The terminal prints a private HTTPS tailnet URL.
5. Val opens that URL in mobile Safari/Chrome while signed into the same tailnet.
6. Cave loads in browser mode with mobile-fit navigation, chat, board, inbox, library, and familiar views.

## Preferred Network Model

Use Tailscale Serve, not Funnel, for the default path.

- Serve is private to devices in the same tailnet.
- Serve can proxy a local service such as `localhost:3000`.
- Serve provides a stable HTTPS URL under the device tailnet name when HTTPS/MagicDNS are enabled.
- Funnel should stay out of scope unless Val explicitly wants public internet access.

Manual baseline:

```bash
pnpm dev -- -H 127.0.0.1 -p 3000
tailscale serve --bg 3000
tailscale serve status
```

Fallback if Serve is unavailable:

```bash
pnpm dev -- -H 0.0.0.0 -p 3000
tailscale ip -4
```

Then open `http://<tailscale-ip>:3000` on the phone. This fallback is less polished because it is plain HTTP and requires the dev server to bind beyond loopback.

## Files

- Create: `scripts/mobile-tailscale.sh`
  - Starts/checks the Next server.
  - Configures `tailscale serve --bg 3000`.
  - Prints the mobile URL and diagnostics.
- Modify: `package.json`
  - Add `mobile:tailscale`.
- Modify: `README.md`
  - Add a short "Mobile over Tailscale" section.
- Create: `docs/mobile-tailscale.md`
  - Full setup/runbook and troubleshooting.
- Create: `src/components/mobile-shell-smoke.test.ts`
  - Static regression checks for mobile-safe browser mode surfaces.
- Optional Modify: `src/components/workspace.tsx`, `src/styles/*.css`
  - Only if mobile QA finds layout overlap or hidden navigation.

---

### Task 1: Add Mobile Tailscale Script

**Files:**
- Create: `scripts/mobile-tailscale.sh`
- Modify: `package.json`

- [ ] **Step 1: Write the script**

Create `scripts/mobile-tailscale.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

PORT="${PORT:-3000}"
HOST="${HOST:-127.0.0.1}"

need() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "missing required command: $1" >&2
    exit 1
  }
}

port_is_listening() {
  node -e "const net=require('net');const s=net.connect({host:process.argv[1],port:Number(process.argv[2])});s.setTimeout(300);s.on('connect',()=>process.exit(0));s.on('timeout',()=>process.exit(1));s.on('error',()=>process.exit(1));" "$HOST" "$PORT"
}

need pnpm
need node
need tailscale

if ! tailscale status --self >/dev/null 2>&1; then
  echo "tailscale is not connected. Run: tailscale up" >&2
  exit 1
fi

if port_is_listening >/dev/null 2>&1; then
  echo "Next server already listening on ${HOST}:${PORT}"
else
  echo "Starting Next server on ${HOST}:${PORT}"
  pnpm dev -- -H "$HOST" -p "$PORT" >"/tmp/coven-cave-mobile-${PORT}.log" 2>&1 &
  NEXT_PID="$!"
  for _ in $(seq 1 40); do
    if port_is_listening >/dev/null 2>&1; then
      break
    fi
    sleep 0.25
  done
  if ! port_is_listening >/dev/null 2>&1; then
    echo "Next server did not start. See /tmp/coven-cave-mobile-${PORT}.log" >&2
    kill "$NEXT_PID" >/dev/null 2>&1 || true
    exit 1
  fi
fi

tailscale serve --bg "$PORT"

echo
echo "CovenCave mobile is available inside your tailnet."
echo "Run this to see the exact URL:"
echo "  tailscale serve status"
echo
tailscale serve status || true
```

- [ ] **Step 2: Make it executable**

Run:

```bash
chmod +x scripts/mobile-tailscale.sh
```

Expected: no output.

- [ ] **Step 3: Add package script**

Modify `package.json` scripts:

```json
"mobile:tailscale": "bash scripts/mobile-tailscale.sh"
```

- [ ] **Step 4: Verify script syntax**

Run:

```bash
bash -n scripts/mobile-tailscale.sh
pnpm exec tsc --noEmit --pretty false
```

Expected: both commands exit `0`.

- [ ] **Step 5: Commit**

```bash
git add package.json scripts/mobile-tailscale.sh
git commit -m "chore(dev): add mobile tailscale launcher"
```

---

### Task 2: Document Mobile Setup

**Files:**
- Create: `docs/mobile-tailscale.md`
- Modify: `README.md`

- [ ] **Step 1: Create full runbook**

Create `docs/mobile-tailscale.md`:

```markdown
# Mobile Access Over Tailscale

This runs CovenCave's browser surface on your development machine and exposes it privately to your phone through Tailscale Serve.

## Requirements

- Tailscale installed and signed in on the development machine.
- Tailscale installed and signed in on the phone.
- Both devices are in the same tailnet.
- MagicDNS and HTTPS are enabled in the tailnet if you want the stable HTTPS Serve URL.
- `pnpm install` has been run in this checkout.
- The local Coven daemon/runtime setup is healthy on the development machine.

## Start

```bash
pnpm mobile:tailscale
```

Open the HTTPS URL printed by:

```bash
tailscale serve status
```

## Manual Equivalent

```bash
pnpm dev -- -H 127.0.0.1 -p 3000
tailscale serve --bg 3000
tailscale serve status
```

## Fallback Without Serve

```bash
pnpm dev -- -H 0.0.0.0 -p 3000
tailscale ip -4
```

Open:

```text
http://<tailscale-ip>:3000
```

Use this only when Serve is unavailable. Prefer Serve because it keeps the app private to the tailnet and gives HTTPS.

## Expected Mobile Behavior

- Chat, Inbox, Board, Library, Familiars, and Settings should load.
- The native Tauri terminal does not run in a mobile browser.
- Native desktop notifications do not run in a mobile browser.
- Browser view uses the web fallback path, not the desktop webview.

## Stop

```bash
tailscale serve reset
pkill -f "next dev.*3000" || true
```

## Troubleshooting

If the phone cannot open the URL:

```bash
tailscale status --self
tailscale serve status
curl -I http://127.0.0.1:3000
```

If the app loads but actions fail, verify the host machine has the Coven daemon/runtime available. The phone is only a browser; the host machine still performs local work.
```

- [ ] **Step 2: Add README pointer**

Add under `## Develop`:

```markdown
### Mobile over Tailscale

For private phone testing on the same tailnet:

```bash
pnpm mobile:tailscale
```

Then open the HTTPS URL from `tailscale serve status` on the phone. See `docs/mobile-tailscale.md`.
```

- [ ] **Step 3: Verify docs commands are discoverable**

Run:

```bash
rg -n "mobile:tailscale|Mobile over Tailscale|tailscale serve" README.md docs/mobile-tailscale.md package.json
```

Expected: matches in all three files.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/mobile-tailscale.md
git commit -m "docs: add mobile tailscale runbook"
```

---

### Task 3: Add Mobile Surface Regression Checks

**Files:**
- Create: `src/components/mobile-shell-smoke.test.ts`

- [ ] **Step 1: Write static smoke test**

Create `src/components/mobile-shell-smoke.test.ts`:

```ts
// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workspace = await readFile(new URL("./workspace.tsx", import.meta.url), "utf8");
const bottomTerminal = await readFile(new URL("./bottom-terminal.tsx", import.meta.url), "utf8");
const browserPane = await readFile(new URL("./browser-pane.tsx", import.meta.url), "utf8");

assert.match(
  bottomTerminal,
  /Running outside Tauri|Only mounts inside the Tauri webview/,
  "Terminal should keep a browser-safe path for mobile web access",
);

assert.match(
  browserPane,
  /outside Tauri|fallback iframe|window\.open/,
  "Browser view should keep a browser fallback path outside the desktop webview",
);

assert.match(
  workspace,
  /mode === "browser" \? null/,
  "Browser mode should keep the hidden top header behavior that fits small screens",
);
```

- [ ] **Step 2: Run test**

```bash
node src/components/mobile-shell-smoke.test.ts
```

Expected: exits `0`.

- [ ] **Step 3: Run compiler**

```bash
pnpm exec tsc --noEmit --pretty false
```

Expected: exits `0`.

- [ ] **Step 4: Commit**

```bash
git add src/components/mobile-shell-smoke.test.ts
git commit -m "test(mobile): cover browser-safe shell surfaces"
```

---

### Task 4: Manual Mobile QA

**Files:**
- No required code changes.
- Modify CSS/components only if a verified mobile defect appears.

- [ ] **Step 1: Start local mobile endpoint**

```bash
pnpm mobile:tailscale
```

Expected:

```text
CovenCave mobile is available inside your tailnet.
```

- [ ] **Step 2: Open from phone**

Open the URL from:

```bash
tailscale serve status
```

Expected: Cave loads without a TLS warning.

- [ ] **Step 3: Verify primary mobile flows**

Check on the phone:

- Chat list opens.
- Existing chat opens.
- Sending a small chat message reaches the host runtime or returns the existing harness diagnostic.
- Board opens and scrolls vertically and horizontally where needed.
- Board task chat button opens the linked chat.
- Library opens.
- Inbox opens.
- Settings opens.
- Browser view does not show the desktop top header row.

- [ ] **Step 4: Capture defects as narrow follow-up tasks**

For each defect, record:

```text
Viewport:
URL:
Steps:
Expected:
Actual:
Screenshot:
Likely file:
```

- [ ] **Step 5: Commit only if fixes were made**

```bash
git add <changed-files>
git commit -m "fix(mobile): <specific issue>"
```

---

### Task 5: Security Review Before Merge

**Files:**
- Review only unless changes are needed.

- [ ] **Step 1: Confirm Serve, not Funnel**

Run:

```bash
tailscale serve status
```

Expected: service is available only through Serve/private tailnet, not Funnel/public internet.

- [ ] **Step 2: Confirm no broad auth bypass was added**

Run:

```bash
git diff origin/main...HEAD -- src/app/api src/lib src/components scripts README.md docs/mobile-tailscale.md
```

Expected:

- No API route disables local security checks for non-tailnet public traffic.
- No secrets or tokens are committed.
- No `tailscale funnel` default path is documented as the main route.

- [ ] **Step 3: Run final verification**

```bash
node src/components/mobile-shell-smoke.test.ts
pnpm exec tsc --noEmit --pretty false
rg -n --pcre2 '[\x{1F000}-\x{1FAFF}\x{2600}-\x{27BF}]' src/app src/components src/lib scripts README.md docs/mobile-tailscale.md
```

Expected:

- Test exits `0`.
- TypeScript exits `0`.
- Emoji scan returns no matches.

- [ ] **Step 4: Merge path**

```bash
git push origin <branch>
git switch main
git pull --ff-only origin main
git merge --no-ff <branch>
pnpm exec tsc --noEmit --pretty false
git push origin main
```

Expected: `origin/main` points at the merge commit and the worktree is clean.

---

## References

- Tailscale Serve: https://tailscale.com/docs/features/tailscale-serve
- Tailscale `serve` command: https://tailscale.com/docs/reference/tailscale-cli/serve
- Tailscale MagicDNS: https://tailscale.com/kb/1081/magicdns
- Next.js local command verified from this checkout: `pnpm exec next dev --help`

## Open Decisions

1. Whether mobile should be a development-only affordance or a supported user-facing mode.
2. Whether to add tailnet-aware API authorization later. For the first version, Tailscale is the access boundary and the app remains local-first.
3. Whether to implement a dedicated mobile layout pass for Board and Inspector after manual QA.
4. Whether to support Tailscale Funnel as an explicit temporary share mode. Default answer should remain no unless public access is required.
