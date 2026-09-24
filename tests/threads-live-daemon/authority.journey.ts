import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { test, expect, type LiveDaemon } from "./fixture";

async function submit(page: Page, live: LiveDaemon) {
  await page.setExtraHTTPHeaders(live.headers);
  await page.goto(`${live.baseURL}/proposals`);
  await page.getByRole("button", { name: "Send an edit", exact: true }).click();
  await page.getByLabel("Familiar ID", { exact: true }).fill("sage");
  await page.getByLabel("Relative file path", { exact: true }).fill("TOOLS.md");
  await page.getByLabel("Full replacement contents", { exact: true }).fill("synthetic tool defaults v2");
  await page.getByRole("button", { name: "Send edit", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Proposals Send an edit", exact: true }).getByRole("status").filter({ hasText: "The daemon staged the edit for review." })).toBeVisible();
  await page.keyboard.press("Escape");
  const pending = readdirSync(path.join(live.home, "pending")).filter(file => file.endsWith(".json"));
  expect(pending).toHaveLength(1);
  const envelope = JSON.parse(readFileSync(path.join(live.home, "pending", pending[0]), "utf8"));
  expect(envelope.schema).toBe("phase5_v1");
  await expect(page.getByRole("button", { name: "Veto", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Approve", exact: true })).toHaveCount(0);
  return envelope.pending.id as string;
}
async function terminal(live: LiveDaemon, proposalId: string, event: string, reason: string) {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(path.join(live.home, "coven.sqlite3"), { readOnly: true });
  try {
    const rows = db.prepare("SELECT event_type, detail FROM ward_audit WHERE proposal_id = ? AND event_type IN ('proposal_approved', 'proposal_vetoed', 'proposal_rejected')").all(proposalId);
    expect(rows).toHaveLength(1);
    expect(rows[0].event_type).toBe(event);
    const detail = JSON.parse(String(rows[0].detail));
    expect(event === "proposal_approved" ? detail.window_close.reason : detail.reason).toBe(reason);
  } finally { db.close(); }
}

test("pending window remains visible until daemon-confirmed application", async ({ page, live }, info) => {
  const id = await submit(page, live);
  await live.tick();
  await live.advance(1799); await live.tick();
  expect(readFileSync(path.join(live.workspace, "TOOLS.md"), "utf8")).toBe("synthetic tool defaults v1");
  await page.reload();
  await expect(page.getByRole("button", { name: "Veto", exact: true })).toBeEnabled();
  await live.advance(1800); await live.tick();
  expect(readFileSync(path.join(live.workspace, "TOOLS.md"), "utf8")).toBe("synthetic tool defaults v1");
  await live.advance(7201); await live.tick();
  await terminal(live, id, "proposal_approved", "applied");
  expect(readFileSync(path.join(live.workspace, "TOOLS.md"), "utf8")).toBe("synthetic tool defaults v2");
  await page.reload();
  // An empty queue is insufficient: the browser must show the confirmed result.
  await expect(page.getByRole("status").filter({ hasText: /applied/i })).toBeVisible();
  for (const [theme, mode, width] of [["coven", "dark", 1280], ["coven", "light", 1280], ["tide", "dark", 390]] as const) {
    await page.setViewportSize({ width, height: 900 });
    const preference = await page.request.patch(`${live.baseURL}/api/preferences`, {
      headers: live.headers, data: { appearance: { theme: { id: theme, modePreference: mode } } },
    });
    expect(preference.status()).toBe(200);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect(page.locator("html")).toHaveAttribute("data-mode", mode);
    await expect(page.getByRole("status").filter({ hasText: /applied/i })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`outcomes-${theme}-${mode}-${width}.png`), animations: "disabled" });
  }
});

test("principal veto and evidence divergence produce single non-applied outcomes", async ({ page, live }) => {
  const vetoId = await submit(page, live);
  await page.getByRole("button", { name: "Veto", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Nothing pending", exact: true })).toBeVisible();
  await terminal(live, vetoId, "proposal_vetoed", "vetoed");
  await expect(page.getByRole("status").filter({ hasText: /confirmed this proposal as vetoed/i })).toHaveCount(1);
  expect(readFileSync(path.join(live.workspace, "TOOLS.md"), "utf8")).toBe("synthetic tool defaults v1");
  const divergedId = await submit(page, live);
  await live.tick(); await live.stopDaemon();
  writeFileSync(path.join(live.workspace, "TOOLS.md"), "Synthetic out-of-band tool change");
  await live.restartDaemon(); await live.advance(7201); await live.tick();
  await terminal(live, divergedId, "proposal_rejected", "evidence_diverged");
  await page.reload();
  await expect(page.getByRole("button", { name: "Approve", exact: true })).toHaveCount(0);
  await expect(page.getByText(/evidence_diverged|evidence diverged/i)).toBeVisible();
});

test("disconnect blocks decisions and restart reconciles without replay", async ({ page, live }) => {
  const id = await submit(page, live);
  await live.stopDaemon(); await page.reload();
  await expect(page.getByRole("button", { name: "Veto", exact: true })).toHaveCount(0);
  await expect(page.getByRole("alert").filter({ hasText: "Blocked — cannot verify staged proposals" })).toBeVisible();
  await page.getByRole("button", { name: "Send an edit", exact: true }).click();
  await expect(page.getByRole("button", { name: "Send edit", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await live.restartDaemon(); await page.reload();
  await expect(page.getByRole("button", { name: "Veto", exact: true })).toBeEnabled();
  await live.advance(7201); await live.tick();
  await live.restartDaemon(); await live.tick();
  await terminal(live, id, "proposal_approved", "applied");
  await page.reload();
  await expect(page.getByRole("status").filter({ hasText: /applied/i })).toHaveCount(1);
  await live.stopDaemon(); await page.reload();
  await expect(page.getByRole("status").filter({ hasText: /applied/i })).toHaveCount(0);
  await expect(page.getByRole("alert").filter({ hasText: "Blocked — cannot verify staged proposals" })).toBeVisible();
});
