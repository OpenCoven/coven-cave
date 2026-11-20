import { expect, test, type Page } from "@playwright/test";

// A default build has no Submissions implementation (#6401). A saved link still
// opens, says so, and keeps saved data exportable and deletable.

const RETAINED = "**/api/opencoven/submissions/retained**";

async function prepare(page: Page, count: number | null) {
  await page.addInitScript(() => window.localStorage.setItem("cave:onboarding:dismissed", "1"));
  const deletes: string[] = [];
  let remaining = count;
  await page.route(RETAINED, async (route) => {
    if (route.request().method() === "DELETE") {
      deletes.push(route.request().url());
      remaining = null;
      return route.fulfill({ json: { ok: true, deleted: true } });
    }
    if (route.request().url().includes("download=1")) {
      // A fetch, because the packaged shell's credential only reaches fetches.
      expect(route.request().resourceType()).toBe("fetch");
      return route.fulfill({ json: { version: 1, submissions: [] } });
    }
    return route.fulfill({
      json: { ok: true, exists: remaining !== null, count: remaining },
    });
  });
  return deletes;
}

test("a saved link says the feature isn't included and offers nothing to do when nothing is saved", async ({ page }) => {
  await prepare(page, null);
  await page.goto("/?mode=submissions");
  await expect(page.getByText("Submissions isn't included in this build")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("You have no saved submissions.")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Export/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Delete…" })).toHaveCount(0);
  await expect(page.getByText("Runtime and harness submissions")).toHaveCount(0);
});

test("saved submissions stay exportable, and deleting takes two steps", async ({ page }) => {
  const deletes = await prepare(page, 2);
  await page.goto("/?mode=submissions");
  await expect(page.getByText(/^2 saved submissions are kept/)).toBeVisible({ timeout: 30_000 });
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /^Export/ }).click();
  expect((await download).suggestedFilename()).toBe("opencoven-submissions.json");

  await page.getByRole("button", { name: "Delete…" }).click();
  expect(deletes).toEqual([]);
  await page.getByRole("button", { name: "Cancel" }).click();
  expect(deletes).toEqual([]);

  await page.getByRole("button", { name: "Delete…" }).click();
  await page.getByRole("button", { name: /^Delete saved submi/ }).click();
  await expect(page.getByText("You have no saved submissions.")).toBeVisible();
  expect(deletes).toHaveLength(1);
  expect(deletes[0]).toContain("confirm=delete");
  await expect(page.getByRole("button", { name: /^Export/ })).toHaveCount(0);
});

test("direct requests name the missing implementation", async ({ request }) => {
  const read = await request.get("/api/opencoven/submissions");
  expect(read.status()).toBe(503);
  expect((await read.json()).code).toBe("submissions-not-installed");

  const plan = await request.post("/api/opencoven/executions", { data: {} });
  expect(plan.status()).toBe(503);
  expect((await plan.json()).code).toBe("submissions-not-installed");
});
