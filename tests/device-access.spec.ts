import { expect, test } from "@playwright/test";
import type { DeviceAccessSnapshot, DeviceRecord } from "../src/lib/server/device-access/contract";

function device(status: DeviceRecord["status"] = "pending"): DeviceRecord {
  return {
    id: "12345678-1234-4567-8123-1234abcdef01", installationId: "browser-install", label: "My phone",
    peer: { tailnet: "example.ts.net", nodeId: "stable-node", userId: "12", loginName: "operator@example.test", deviceName: "Phone" },
    status, createdAt: Date.now(), pairingExpiresAt: Date.now() + 300_000,
    decidedAt: null, decidedBy: null, lastSeenAt: null, revokedAt: null,
  };
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("cave:onboarding:dismissed", "1"));
});

test("browser requests approval, survives reload, and displays denial without granting access", async ({ page }) => {
  let current: DeviceRecord | null = null;
  await page.route("**/api/device-access/status", (route) => route.fulfill({
    status: current ? 200 : 403, json: current ? { ok: true, device: current } : { ok: false },
  }));
  await page.route("**/api/device-access/requests", async (route) => {
    const body = route.request().postDataJSON();
    expect(body.installationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.label).toBe("My phone");
    current = device();
    await route.fulfill({ status: 201, json: { ok: true, device: current, credential: "cave-device-v1.fixture" } });
  });
  await page.goto("/connect");
  await page.getByLabel("Device label").fill("My phone");
  await page.getByRole("button", { name: "Request access", exact: true }).click();
  await expect(page.getByText("abcdef01", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Request access", exact: true })).toBeDisabled();
  const installation = await page.evaluate(() => localStorage.getItem("cave:device-installation"));
  await page.reload();
  await expect(page.getByText("abcdef01", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("cave:device-installation"))).toBe(installation);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain("cave-device-v1.");
  current = device("denied");
  await expect(page.getByText("denied", { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(page).toHaveURL(/\/connect$/);
  await expect(page.getByRole("button", { name: "Request access", exact: true })).toBeEnabled();
  current = device("allowed");
  await page.reload();
  await expect(page).toHaveURL(/\/$/, { timeout: 30_000 });
});

test("desktop requires migration consent, then offers Allow, Deny and Revoke", async ({ page }) => {
  const snapshot: DeviceAccessSnapshot = { enabled: false, allowedTailnets: [], devices: [], events: [] };
  await page.route("**/api/device-access/admin", (route) => route.fulfill({
    json: { ok: true, ...snapshot, network: { host: "desktop.example.ts.net", tailnet: "example.ts.net" }, networkError: null },
  }));
  await page.route("**/api/device-access/admin/tailnets", async (route) => {
    expect(route.request().method()).toBe("PUT");
    snapshot.allowedTailnets = route.request().postDataJSON().tailnets;
    snapshot.enabled = true;
    snapshot.devices = [device()];
    await route.fulfill({ json: { ok: true } });
  });
  await page.route("**/api/device-access/admin/decision", async (route) => {
    const payload = route.request().postDataJSON();
    expect(payload.id).toBe(snapshot.devices[0].id);
    snapshot.devices[0] = device(payload.decision);
    await route.fulfill({ json: { ok: true, device: snapshot.devices[0] } });
  });
  await page.goto("/settings#phone");
  await page.getByRole("button", { name: "Phone", exact: true }).click();
  const panel = page.getByRole("region", { name: "Device access" });
  await panel.getByRole("button", { name: "Set up device approval" }).click();
  await expect(panel.getByRole("button", { name: "Save tailnets" })).toBeDisabled();
  await panel.getByRole("checkbox").check();
  await panel.getByRole("button", { name: "Save tailnets" }).click();
  await expect(panel.getByText("Desktop-managed access is on.", { exact: false })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Deny", exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "Allow", exact: true }).click();
  await panel.getByRole("button", { name: "Revoke access", exact: true }).click();
  await expect(panel.getByText(/My phone.*revoked/)).toBeVisible();
  await expect(panel.getByRole("button", { name: "Revoke access", exact: true })).toHaveCount(0);
});
