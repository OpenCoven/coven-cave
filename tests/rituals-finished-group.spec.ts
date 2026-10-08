import { expect, test, type Page } from "@playwright/test";

// Rituals → Overview → Needs you gathers session-finished notifications into
// one Finished row with a one-click Dismiss all (#5873). The asks keep their
// own rows, and the heading counts only them.
//
// Daemon-less: /api/inbox and /api/codex-automations are mocked, and the bulk
// dismiss is captured instead of reaching a real inbox.

const NOW = Date.now();
const iso = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString();

const base = {
  recurrence: { type: "none" },
  source: "agent",
  familiarId: "nova",
  status: "fired",
} as const;

const ASKS = [
  { ...base, id: "ask-approve", kind: "response-needed", title: "Approve the release notes", source: "agent", firedAt: iso(5) },
  { ...base, id: "ask-mission", kind: "agent", title: "Mission needs a decision", auto: "auto-mission", firedAt: iso(30) },
  { ...base, id: "ask-reminder", kind: "reminder", title: "Water the plants", source: "user", firedAt: iso(90) },
];
const FINISHED = Array.from({ length: 25 }, (_, index) => ({
  ...base,
  id: `finished-${index}`,
  kind: "agent",
  title: `Nova finished: chat ${index}`,
  auto: "session-finished",
  sessionId: `session-${index}`,
  link: { kind: "session", ref: `session-${index}` },
  firedAt: iso(10 + index),
}));
type MockItem = Record<string, unknown> & { id: string; status: string };
const items = (): MockItem[] =>
  [...ASKS, ...FINISHED].map((item) => ({ ...item, createdAt: item.firedAt, updatedAt: item.firedAt }));

async function openRituals(page: Page) {
  let inbox = items();
  const dismissals: string[][] = [];
  const singleWrites: string[] = [];
  // The server picks the setup gate from this cookie; localStorage covers the client.
  await page.context().addCookies([
    { name: "cave_onboarding_dismissed", value: "1", domain: "127.0.0.1", path: "/" },
  ]);
  await page.addInitScript(() => window.localStorage.setItem("cave:onboarding:dismissed", "1"));
  await page.route("**/api/inbox/bulk", async (route) => {
    const body = route.request().postDataJSON() as { action: string; ids: string[] };
    expect(body.action).toBe("dismiss");
    dismissals.push(body.ids);
    inbox = inbox.map((item) => (body.ids.includes(item.id) ? { ...item, status: "dismissed" } : item));
    await route.fulfill({ json: { ok: true, changed: body.ids.length } });
  });
  // Every other inbox write stays in the browser: no request reaches a real inbox.
  await page.route(/\/api\/inbox\/(?!bulk)[^?]+/, async (route) => {
    if (route.request().method() === "GET") return route.fallback();
    const id = decodeURIComponent(new URL(route.request().url()).pathname.split("/")[3] ?? "");
    singleWrites.push(id);
    inbox = inbox.map((item) => (item.id === id ? { ...item, status: "dismissed" } : item));
    const item = inbox.find((entry) => entry.id === id);
    await route.fulfill({ json: { ok: true, item } });
  });
  await page.route(/\/api\/inbox(\?.*)?$/, (route) =>
    route.request().method() === "GET" ? route.fulfill({ json: { ok: true, items: inbox } }) : route.fallback());
  await page.route("**/api/codex-automations**", (route) =>
    route.request().method() === "GET" ? route.fulfill({ json: { ok: true, automations: [] } }) : route.fallback());
  await page.goto("/?mode=inbox", { waitUntil: "domcontentloaded" });
  const needs = page.locator(".rituals-overview__needs");
  // The lazy Rituals chunk compiles on first visit under `next dev`.
  await expect(needs).toBeVisible({ timeout: 90_000 });
  return { needs, dismissals, singleWrites };
}

test.describe("Rituals · Needs you · Finished group (#5873)", () => {
  test.setTimeout(150_000);
  test("finished notifications collapse into one row after the asks", async ({ page }) => {
    const { needs } = await openRituals(page);
    await expect(needs.getByRole("heading", { name: "Needs you · 3" })).toBeVisible();
    for (const ask of ASKS) await expect(needs.getByText(ask.title, { exact: true })).toBeVisible();
    const group = needs.getByRole("button", { name: /Finished · 25/ });
    await expect(group).toHaveAttribute("aria-expanded", "false");
    await expect(group).toContainText("Nova finished: chat 0");
    await expect(needs.getByText("Nova finished: chat 5", { exact: true })).toHaveCount(0);
    // The group comes after every ask.
    const rows = await needs.locator(":scope > ul > li").allTextContents();
    expect(rows.at(-1)).toContain("Finished · 25");
  });

  test("opening lists them a page at a time, and one can be dismissed", async ({ page }) => {
    const { needs, dismissals, singleWrites } = await openRituals(page);
    await needs.getByRole("button", { name: /Finished · 25/ }).click();
    const list = needs.getByRole("list", { name: "Finished chats" });
    await expect(list.getByRole("button", { name: /^Dismiss Nova finished/ })).toHaveCount(20);
    await list.getByRole("button", { name: "Show 5 more of 5" }).click();
    await expect(list.getByRole("button", { name: /^Dismiss Nova finished/ })).toHaveCount(25);
    await list.getByRole("button", { name: "Dismiss Nova finished: chat 3" }).click();
    await expect.poll(() => singleWrites).toEqual(["finished-3"]);
    expect(dismissals).toHaveLength(0);
    await expect(needs.getByRole("button", { name: /Finished · 24/ })).toBeVisible();
  });

  test("Dismiss all clears every finished notification in one request", async ({ page }) => {
    const { needs, dismissals } = await openRituals(page);
    await needs.getByRole("button", { name: "Dismiss all 25 finished chats" }).click();
    await expect.poll(() => dismissals.length).toBe(1);
    expect(new Set(dismissals[0])).toEqual(new Set(FINISHED.map((item) => item.id)));
    await expect(needs.getByRole("button", { name: /Finished · / })).toHaveCount(0);
    await expect(needs.getByRole("heading", { name: "Needs you · 3" })).toBeVisible();
  });
});
