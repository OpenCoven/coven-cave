// Capture the README chat.png against a synthetic but realistic
// conversation. Without a `coven` daemon-backed chat history we mock
// /api/sessions/list, /api/familiars, /api/onboarding/status, and
// /api/chat/conversation/[id] so chat-view renders a populated thread
// (markdown + a syntax-highlighted code block).
//
// Run: node scripts/capture-chat-screenshot.mjs

import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = resolve(ROOT, "screenshots");

const VIEWPORT = { width: 1440, height: 900 };
const DPR = 2;

const SESSION_ID = "demo-builder-2a-relay";
const FAMILIAR_ID = "builder";

const CONVERSATION = {
  sessionId: SESSION_ID,
  familiarId: FAMILIAR_ID,
  harness: "claude-code",
  title: "Phase 2A: relay PR ready to merge?",
  createdAt: new Date(Date.now() - 18 * 60 * 1000).toISOString(),
  updatedAt: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
  turns: [
    {
      id: "t1",
      role: "user",
      text: "What's left on Phase 2A before we can merge the relay PR?",
      createdAt: new Date(Date.now() - 18 * 60 * 1000).toISOString(),
    },
    {
      id: "t2",
      role: "assistant",
      text: [
        "PR [#152](https://github.com/OpenCoven/coven/pull/152) is open and CI is green. Here's where each subtask landed:",
        "",
        "- **Scaffold** — compiles, no warnings",
        "- **Workspace tests** — 4/4 passing locally and on CI",
        "- **`fly.toml`** — wired to `relay.opencoven.dev` in the `ord` region",
        "- **Health endpoint** — returns `200 OK` with peer count + uptime",
        "",
        "The only thing _not_ wired in 2A is auth + peer routing — that's 2B, deliberately scoped out so this PR stays reviewable.",
        "",
        "Here's the relevant slice of `relay/src/server.ts`:",
        "",
        "```ts",
        "export async function serve(port: number, peers: Peer[]) {",
        "  const app = new Hono();",
        "  app.get(\"/healthz\", (c) =>",
        "    c.json({ ok: true, peers: peers.length, uptime: process.uptime() }),",
        "  );",
        "  app.post(\"/relay\", relayHandler(peers));",
        "  return serveStatic(app, { port });",
        "}",
        "```",
        "",
        "Nothing is blocking. Ready to merge when you are.",
      ].join("\n"),
      createdAt: new Date(Date.now() - 17 * 60 * 1000).toISOString(),
      durationMs: 4_200,
    },
    {
      id: "t3",
      role: "user",
      text: "Any concurrent-write concerns on the escalations side?",
      createdAt: new Date(Date.now() - 8 * 60 * 1000).toISOString(),
    },
    {
      id: "t4",
      role: "assistant",
      text: [
        "Checked `src/lib/escalations.ts` — it uses a `globalThis.__escalationsWriteChain` mutex that serialises all read-modify-write sequences, so two concurrent POSTs can't race each other.",
        "",
        "Same pattern as the reminders inbox, which has been in production since v0.110. Safe to ship.",
      ].join("\n"),
      createdAt: new Date(Date.now() - 7 * 60 * 1000).toISOString(),
      durationMs: 2_100,
    },
  ],
};

const SESSION_LIST = [
  {
    id: SESSION_ID,
    project_root: "/Users/dev/Projects/OpenCoven/coven",
    harness: "claude-code",
    title: CONVERSATION.title,
    status: "running",
    exit_code: null,
    archived_at: null,
    created_at: CONVERSATION.createdAt,
    updated_at: CONVERSATION.updatedAt,
    familiarId: FAMILIAR_ID,
    origin: "chat",
  },
  {
    id: "demo-builder-vault-mutex",
    project_root: "/Users/dev/Projects/OpenCoven/coven",
    harness: "claude-code",
    title: "Vault write-chain — confirm mutex shape",
    status: "complete",
    exit_code: 0,
    archived_at: null,
    created_at: new Date(Date.now() - 90 * 60 * 1000).toISOString(),
    updated_at: new Date(Date.now() - 65 * 60 * 1000).toISOString(),
    familiarId: FAMILIAR_ID,
    origin: "chat",
  },
  {
    id: "demo-builder-board-search",
    project_root: "/Users/dev/Projects/OpenCoven/coven-cave",
    harness: "claude-code",
    title: "board: refactor search to honor `is:open` + `cwd:` filters",
    status: "complete",
    exit_code: 0,
    archived_at: null,
    created_at: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    familiarId: FAMILIAR_ID,
    origin: "chat",
  },
];

const FAMILIARS = [
  {
    id: FAMILIAR_ID,
    display_name: "Builder",
    role: "Build Familiar",
    harness: "claude-code",
    model: "claude-opus-4.7",
    status: "active",
    active_sessions: 1,
    icon: "ph:robot",
    note: "Working on Hexes Phase 2A",
    memory_freshness: "fresh",
  },
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

  await ctx.route("**/api/onboarding/status", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        complete: true,
        steps: {
          covenCli: { ok: true },
          covenHome: { ok: true },
          adapters: { ok: true },
          daemon: { ok: true },
          familiars: { ok: true },
          binding: { ok: true },
        },
      }),
    }),
  );

  await ctx.route("**/api/familiars", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, familiars: FAMILIARS }),
    }),
  );

  await ctx.route("**/api/sessions/list*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, sessions: SESSION_LIST }),
    }),
  );

  await ctx.route(`**/api/chat/conversation/${SESSION_ID}*`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, conversation: CONVERSATION }),
    }),
  );

  console.log("→ navigating");
  await page.goto("http://localhost:3000", { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(2500);

  // Click into Familiars mode
  await page.getByRole("button", { name: "Familiars", exact: true }).first().click();
  await page.waitForTimeout(1500);

  // Wait for the chat row to actually render. The list lives inside the
  // detail pane and is hydrated after sessions/list resolves.
  const row = page.getByText("Phase 2A: relay PR ready to merge?", { exact: true }).first();
  try {
    await row.waitFor({ state: "visible", timeout: 10_000 });
    await row.click();
    // Wait for Shiki's async syntax highlighting to land — the code
    // block goes from raw <pre> to a coloured one once highlighter
    // attaches the `.shiki` class.
    // Markdown rendering is async (mdToHtml in MessageBubble useEffect).
    // Wait for a rendered <ul>/<li> from our mock's bullet list to show
    // that prose has settled. Then a small extra beat for Shiki.
    await page.waitForSelector("li:has-text('Scaffold'), strong:has-text('Scaffold')", {
      timeout: 10_000,
    }).catch(() => console.warn("markdown render not detected"));
    await page.waitForSelector("pre.shiki, pre code.shiki, .shiki code, [class*=shiki]", {
      timeout: 6_000,
    }).catch(() => console.warn("shiki class not found, capturing raw code"));
    await page.waitForTimeout(1200);

    // Scroll the conversation pane up so the assistant's intro turn is
    // visible. The scrollable area is identified by its `[data-chat-scroll]`
    // attribute when present, otherwise we try a few likely locators.
    await page.evaluate(() => {
      const candidates = [
        document.querySelector("[data-chat-scroll]"),
        document.querySelector(".chat-scroll-area"),
        document.querySelector("main [class*='overflow-y']"),
        document.querySelector("main"),
      ].filter(Boolean);
      for (const el of candidates) {
        if (el && el.scrollHeight > el.clientHeight) {
          el.scrollTop = 0;
          return;
        }
      }
    });
    await page.waitForTimeout(600);
  } catch (e) {
    console.warn("relay-PR row never appeared:", e.message);
  }

  await page.screenshot({
    path: resolve(OUT, "chat.png"),
    fullPage: false,
    type: "png",
    animations: "disabled",
  });
  console.log("OK chat.png");

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
