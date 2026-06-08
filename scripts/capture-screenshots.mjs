// Drive a headed Chromium against http://localhost:3000 and capture
// each of the README-referenced screenshots. Requires the dev server
// to already be running with NEXT_PUBLIC_DEMO=true so sidebar + sample
// activity are populated.
//
// Run: node scripts/capture-screenshots.mjs

import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = resolve(ROOT, "screenshots");

// Logical viewport for marketing-clean shots. Playwright captures at the
// configured deviceScaleFactor, so 2 gives a 2× retina export.
const VIEWPORT = { width: 1440, height: 900 };
const DPR = 2;

// Sidebar IA after the redesign (commit 040e7be): "Familiars" / "Tasks"
// modes were folded into Chat / Board respectively. "Floor" no longer has
// its own tab — it's an ambient surface inside HomeComposer. The capture
// loop falls through to "home" for floor and just captures the shell with
// the floor mini visible.
const CAPTURES = [
  { file: "home.png",     label: "HomeComposer cold-start",      click: "Home" },
  { file: "shell.png",    label: "Three-pane shell + chat",      click: "Chat" },
  { file: "chat.png",     label: "Chat view",                    click: "Chat" },
  { file: "board.png",    label: "Board view",                   click: "Board" },
  { file: "library.png",  label: "Library",                      click: "Library" },
  { file: "calendar.png", label: "Calendar (week view)",         click: "Calendar" },
  { file: "terminal.png", label: "Terminal surface",             click: "Terminal" },
  { file: "floor.png",    label: "Coven Floor (Home ambient)",   click: "Home" },
];

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: DPR,
    colorScheme: "dark",
  });
  const page = await ctx.newPage();
  page.on("pageerror", (err) => console.warn("[pageerror]", err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") console.warn("[console.error]", msg.text());
  });

  // Intercept the onboarding-status endpoint so the setup overlay doesn't
  // mount over the views we want to capture. With no `coven` daemon
  // running, the real endpoint reports daemon/familiars/binding as missing
  // and the overlay blocks the entire workspace.
  await ctx.route("**/api/onboarding/status", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        complete: true,
        steps: {
          covenCli: { ok: true, detail: "/usr/local/bin/coven" },
          covenHome: { ok: true, detail: "~/.coven" },
          adapters: { ok: true, detail: "Codex, Claude Code" },
          daemon: { ok: true },
          familiars: { ok: true },
          binding: { ok: true },
        },
      }),
    });
  });

  console.log("→ navigating to http://localhost:3000");
  await page.goto("http://localhost:3000", { waitUntil: "domcontentloaded", timeout: 60_000 });
  // Allow client hydration + initial data fetch.
  await page.waitForTimeout(3500);

  // If the overlay still mounted before our intercept took effect, click
  // its "Open Cave" / dismiss button.
  const openCave = page.getByRole("button", { name: /open cave/i }).first();
  if (await openCave.count()) {
    await openCave.click().catch(() => {});
    await page.waitForTimeout(500);
  }

  for (const cap of CAPTURES) {
    console.log(`→ ${cap.file} (${cap.label})`);
    try {
      // Click the sidebar folder row for this mode. The row contains an
      // icon + label + optional <kbd>⌘N</kbd>, so the accessible name is
      // "Home ⌘1" rather than just "Home" — match by CSS class + visible
      // label instead of role+exact-name.
      const btn = page
        .locator(`.sidebar-folder-row:has(.sidebar-folder-label:text-is("${cap.click}"))`)
        .first();
      const hit = await btn.count();
      if (hit > 0) {
        await btn.click({ timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(800);
      } else {
        console.warn(`  no sidebar folder row "${cap.click}" — capturing current state`);
      }

      // Surface-specific tweaks
      if (cap.file === "chat.png") {
        // After landing on Chat, click the first session row in the chat
        // list so the right pane shows a real conversation thread.
        // The session rows are buttons with the session title; any text
        // works since we just want SOMETHING populated.
        const firstChat = page
          .locator(".cave-mode-fade button:has-text('Codex'), .cave-mode-fade button:has-text('Chat'), main [role='button']:has-text('Codex')")
          .first();
        if (await firstChat.count()) {
          await firstChat.click({ timeout: 3000 }).catch(() => {});
          await page.waitForTimeout(1500);
        } else {
          // Fallback: click the first session row by its session title.
          const anyRow = page
            .locator("main button, [role='main'] button")
            .filter({ hasText: /update|task|hello|Patch|please|context|why|what|how|fix|feat/i })
            .first();
          if (await anyRow.count()) {
            await anyRow.click({ timeout: 3000 }).catch(() => {});
            await page.waitForTimeout(1500);
          } else {
            console.warn("  no chat row matched");
          }
        }
      }

      await page.screenshot({
        path: resolve(OUT, cap.file),
        fullPage: false,
        type: "png",
        animations: "disabled",
      });
      console.log(`  OK ${cap.file}`);
    } catch (err) {
      console.error(`  ERR ${cap.file}: ${err.message}`);
    }
  }

  await browser.close();
  console.log("done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
