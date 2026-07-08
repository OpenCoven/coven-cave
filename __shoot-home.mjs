import { chromium } from "@playwright/test";

const PORT = process.env.PORT ?? "3300";
const iso = (h) => new Date(Date.now() - h * 3_600_000).toISOString();
const SESSIONS = [
  { id: "s1", title: "Refactor the auth flow end to end", status: "running", origin: "chat", project_root: "/repo/alpha", familiarId: "nova", harness: "codex", updated_at: iso(1), created_at: iso(2), exit_code: null, archived_at: null },
  { id: "s2", title: "Wire the deploy pipeline for staging", status: "completed", origin: "board", project_root: "/repo/beta", familiarId: "kitty", harness: "codex", updated_at: iso(3), created_at: iso(5), exit_code: 0, archived_at: null },
  { id: "s3", title: "Draft the API docs for the public routes", status: "idle", origin: "chat", project_root: "/repo/alpha", familiarId: "sage", harness: "claude", updated_at: iso(6), created_at: iso(8), exit_code: null, archived_at: null },
];
const RSS = [
  { title: "A major model release reshapes the agent landscape", url: "https://example.com/1", source: "TechDaily", publishedAt: iso(2), image: null },
  { title: "Open-source tooling round-up for the week", url: "https://example.com/2", source: "DevWeekly", publishedAt: iso(5), image: null },
  { title: "How teams are wiring multi-agent coordination", url: "https://example.com/3", source: "AI Report", publishedAt: iso(9), image: null },
];

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
await ctx.addInitScript(() => {
  localStorage.setItem("cave:onboarding:dismissed", "1");
  localStorage.setItem("cave:active-familiar", "nova");
});
const page = await ctx.newPage();
await page.route("**/api/familiars**", (r) => r.fulfill({ json: { ok: true, familiars: [
  { id: "nova", display_name: "Nova", role: "Orchestrator", status: "active", icon: "ph:sparkle-fill" },
  { id: "kitty", display_name: "Kitty", role: "Builder", status: "active", icon: "ph:sparkle-fill" },
  { id: "sage", display_name: "Sage", role: "Research", status: "active", icon: "ph:sparkle-fill" },
] } }));
await page.route("**/api/sessions/list**", (r) => r.fulfill({ json: { ok: true, sessions: SESSIONS } }));
await page.route("**/api/rss**", (r) => r.fulfill({ json: { ok: true, items: RSS } }));
await page.route("**/api/inbox**", (r) => r.fulfill({ json: { ok: true, items: [] } }));

await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "commit", timeout: 90_000 });
await page.waitForSelector(".home-composer-root", { timeout: 45_000 });
await page.waitForTimeout(2500);

const info = await page.evaluate(() => {
  const card = document.querySelector(".home-composer-card-wrap");
  const digest = document.querySelector(".home-digest");
  const rect = (el) => (el ? { w: Math.round(el.getBoundingClientRect().width), x: Math.round(el.getBoundingClientRect().x) } : null);
  return {
    carouselPresent: !!digest,
    columnsPresent: !!document.querySelector(".home-columns"),
    composer: rect(card),
    carousel: rect(digest),
    tracks: document.querySelectorAll(".home-digest__track").length,
  };
});
console.log(JSON.stringify(info, null, 2));
await page.screenshot({ path: "/tmp/cave-home.png", fullPage: false });
await b.close();
