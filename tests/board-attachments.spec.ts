import { test, expect } from "@playwright/test";

// Home-composer attachment staging, end to end (originally arc #2219→#2234,
// updated for consolidated toolbar where Task destination moved to board view).
// Daemon-less: only familiars/sessions/escalations routes are mocked.

test("home composer files stage and display as chips with remove controls", async ({ page }) => {
  await page.route("**/api/familiars**", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, familiars: [] }) }),
  );
  await page.route("**/api/sessions/list**", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, sessions: [] }) }),
  );
  await page.route("**/api/escalations**", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, count: 0 }) }),
  );
  await page.addInitScript(() => window.localStorage.setItem("cave:onboarding:dismissed", "1"));

  await page.goto("/");
  await page.waitForSelector(".shell-frame", { timeout: 60000 });
  await page.waitForSelector(".hc-textarea", { timeout: 60000 });

  // ── Stage two files ──────────────────────────────────────────────────────────
  await page.locator(".hc-file-input").setInputFiles([
    {
      name: "spec.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# Spec\n- do the thing\n"),
    },
    {
      name: "shot.png",
      mimeType: "image/png",
      buffer: Buffer.from("fake image bytes"),
    },
  ]);

  // Both chips appear
  await expect(page.locator(".hc-attachment-name")).toHaveText(["spec.md", "shot.png"]);

  // Count header reads "2/10 attached"
  await expect(page.locator(".hc-attachments-count")).toHaveText("2/10 attached");

  // ── Per-chip remove ──────────────────────────────────────────────────────────
  await page.getByRole("button", { name: "Remove spec.md" }).click();
  await expect(page.locator(".hc-attachment-name")).toHaveText(["shot.png"]);
  await expect(page.locator(".hc-attachments-count")).toHaveText("1/10 attached");

  // ── Clear all ────────────────────────────────────────────────────────────────
  await page.locator(".hc-attachments-clear").click();
  await expect(page.locator(".hc-attachments")).not.toBeVisible();
});
