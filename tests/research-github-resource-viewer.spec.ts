import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { join } from "node:path";

const COMMIT_SHA = "a".repeat(40);
const README_SHA = "b".repeat(40);
const SOURCE_SHA = "c".repeat(40);
const LINK_ID = "github-viewer-e2e";

const GITHUB_SUMMARY = {
  version: 1,
  owner: "OpenCoven",
  repo: "coven-cave",
  description: "Desktop control room for OpenCoven familiars and workflows.",
  primaryLanguage: "TypeScript",
  licenseSpdx: "MIT",
  visibility: "public",
  stars: 842,
  forks: 61,
  defaultBranch: "main",
  resolvedRef: "main",
  commitSha: COMMIT_SHA,
  fetchedAt: "2026-09-02T14:00:00.000Z",
  truncated: true,
};

const SAVED_LINK = {
  id: LINK_ID,
  url: "https://github.com/OpenCoven/coven-cave",
  category: "github",
  title: "OpenCoven/coven-cave",
  addedAt: "2026-09-02T14:00:00.000Z",
  source: "desk",
  githubRepo: GITHUB_SUMMARY,
};

const SAVED_LINK_DETAIL = {
  ...SAVED_LINK,
  githubRepo: {
    ...GITHUB_SUMMARY,
    tree: [
      { path: "README.md", type: "blob", sha: README_SHA, size: 128 },
      { path: "src", type: "tree", sha: COMMIT_SHA },
      { path: "src/index.ts", type: "blob", sha: SOURCE_SHA, size: 31 },
      { path: "docs/guides/reader.md", type: "blob", sha: "d".repeat(40), size: 80 },
    ],
    readme: {
      path: "README.md",
      markdown: "# Coven Cave\n\nA commit-pinned saved repository snapshot.\n\n## Read the repository, not a moving branch\n\nCaptured paths and source links remain tied to this commit. Browse the saved tree, then bring the resource into a research run.\n\n```ts\nexport const snapshot = { ref: \"main\", immutable: true };\n```\n\n" +
        Array.from({ length: 18 }, (_, index) => `### Reference ${index + 1}\n\nA saved repository is evidence at a point in time. Keep the captured commit, date, and any incomplete tree listing visible while reading.\n\n`).join(""),
    },
  },
};

type GithubRequests = {
  detailIds: string[];
  blobUrls: string[];
};

async function boot(page: Page): Promise<GithubRequests> {
  const requests: GithubRequests = { detailIds: [], blobUrls: [] };
  await page.addInitScript(() => {
    window.localStorage.setItem("cave:onboarding:dismissed", "1");
    window.localStorage.setItem("cave:active-familiar", "rida");
    window.localStorage.setItem("cave:research:tab", "resources");
  });
  await page.route("**/api/**", (route) => route.fulfill({ json: { ok: true } }));
  await page.route(/\/api\/projects(?:\?.*)?$/, (route) => route.fulfill({
    json: { ok: true, projects: [{ id: "reader-fixture", name: "Reader fixture", root: "/fixture/reader", createdAt: "2026-09-02T14:00:00.000Z", updatedAt: "2026-09-02T14:00:00.000Z" }] },
  }));
  await page.route("**/api/familiars**", (route) =>
    route.fulfill({
      json: {
        ok: true,
        familiars: [{
          id: "rida",
          display_name: "Rida",
          role: "Researcher",
          status: "active",
          icon: "ph:sparkle-fill",
        }],
      },
    }));
  await page.route("**/api/sessions/list**", (route) =>
    route.fulfill({ json: { ok: true, sessions: [] } }));
  await page.route(/\/api\/roles(?:\?|$)/, (route) =>
    route.fulfill({ json: { roles: [] } }));
  await page.route(/\/api\/research\/missions(?:\?.*)?$/, (route) =>
    route.fulfill({ json: { ok: true, missions: [] } }));
  await page.route(/\/api\/research\/generations/, (route) =>
    route.fulfill({ json: { ok: true, generations: [] } }));
  await page.route(/\/api\/research\/resources(?:\?.*)?$/, (route) =>
    route.fulfill({ json: { ok: true, resources: [] } }));
  await page.route(/\/api\/research\/links(?:\?.*)?$/, (route) => {
    const id = new URL(route.request().url()).searchParams.get("id");
    if (id !== null) {
      requests.detailIds.push(id);
      return route.fulfill({ json: { ok: true, link: SAVED_LINK_DETAIL } });
    }
    return route.fulfill({ json: { ok: true, links: [SAVED_LINK] } });
  });
  await page.route("**/api/research/github-repo/file**", (route) => {
    requests.blobUrls.push(route.request().url());
    return route.fulfill({
      json: {
        ok: true,
        sha: SOURCE_SHA,
        text: 'export const cave = "verified";\n',
        bytes: 32,
      },
    });
  });

  await page.goto("/");
  await page.getByRole("navigation").first().waitFor({ timeout: 60_000 });
  await expect(async () => {
    await page.evaluate(() =>
      window.dispatchEvent(new CustomEvent("cave:navigate-mode", {
        detail: { mode: "surface:researcher-desk" },
      })));
    await expect(page.locator(".research-desk")).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 90_000 });
  await page
    .getByRole("tablist", { name: "Research desk views" })
    .getByRole("tab", { name: /^Resources/ })
    .click();
  return requests;
}

async function capture(page: Page, info: TestInfo, name: string) {
  if (process.env.CAVE_READER_EVIDENCE_DIR) {
    await page.screenshot({ path: join(process.env.CAVE_READER_EVIDENCE_DIR, `${info.project.name}-${name}.png`), animations: "disabled" });
  }
}

test.describe("saved GitHub repository viewer", () => {
  test.describe.configure({ timeout: 180_000 });
  test.use({ serviceWorkers: "block" });

  test("loads persisted detail and reads an exact captured blob in Cave", async ({ page }, info) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const requests = await boot(page);
    await page
      .locator(".research-res")
      .getByRole("button", { name: "OpenCoven/coven-cave — open details" })
      .click();

    const viewer = page.getByRole("region", {
      name: "OpenCoven/coven-cave repository workbench",
    });
    await expect(viewer).toBeVisible();
    await expect.poll(() => requests.detailIds).toEqual([LINK_ID]);
    await expect(viewer.getByText(COMMIT_SHA.slice(0, 12), { exact: true })).toBeVisible();
    await expect(viewer.getByRole("heading", { name: "Coven Cave" })).toBeVisible();
    await expect(viewer.getByText("Saved GitHub repository")).toHaveCount(0);
    await expect(viewer.getByTitle("Read README.md")).toHaveCount(1);

    const dialogBox = await page.getByRole("dialog").boundingBox();
    const viewport = page.viewportSize();
    expect(dialogBox).not.toBeNull();
    expect(viewport).not.toBeNull();
    expect(dialogBox!.width).toBeGreaterThan(viewport!.width * 0.9);
    expect(dialogBox!.height).toBeGreaterThan(viewport!.height * 0.9);
    const documentBody = viewer.locator(".research-gh__reader-body");
    expect(await documentBody.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
    const dialog = page.locator(".research-res-overlay__dialog");
    expect(await dialog.evaluate((element) => element.scrollHeight <= element.clientHeight + 1)).toBe(true);
    expect(await dialog.locator(".research-res-overlay__head").evaluate((element) => element.clientHeight)).toBeLessThan(60);
    const proseStart = (await viewer.locator(".research-gh__markdown > p").first().boundingBox())!.x;
    expect(Math.abs((await viewer.getByRole("heading", { name: "Coven Cave" }).boundingBox())!.x - proseStart)).toBeLessThan(2);
    await capture(page, info, "wide");

    const search = viewer.getByRole("searchbox", { name: "Search captured files" });
    await search.fill("guides/reader");
    await expect(viewer.getByTitle("Read docs/guides/reader.md")).toBeVisible();
    await expect(viewer.getByRole("heading", { name: "Coven Cave" })).toBeVisible();
    expect(requests.blobUrls).toHaveLength(0);
    await search.fill("not-captured");
    await expect(viewer.getByText(/No captured files match/)).toBeVisible();
    await search.fill("");

    await viewer.locator("summary.research-gh__dir-summary", { hasText: "src" }).click();
    await viewer.getByTitle("Read src/index.ts").click();

    await expect(viewer.getByText('export const cave = "verified";', { exact: true })).toBeVisible();
    await expect(viewer.locator(".research-gh__line-number")).toHaveText(["1", "2"]);
    await expect.poll(() => requests.blobUrls).toHaveLength(1);
    const blobUrl = new URL(requests.blobUrls[0]);
    expect(blobUrl.pathname).toBe("/api/research/github-repo/file");
    expect(blobUrl.searchParams.get("repo")).toBe("OpenCoven/coven-cave");
    expect(blobUrl.searchParams.get("sha")).toBe(SOURCE_SHA);

    const rail = viewer.getByRole("navigation", { name: "Repository files" });
    const beforeResize = (await rail.boundingBox())!.width;
    const separator = viewer.getByRole("separator", { name: "Resize file rail" });
    await separator.focus();
    await page.keyboard.press("ArrowRight");
    await expect.poll(async () => (await rail.boundingBox())!.width).toBeGreaterThan(beforeResize);
    const resizedWidth = (await rail.boundingBox())!.width;
    await viewer.getByRole("button", { name: "Collapse file rail" }).click();
    await expect(viewer.getByRole("button", { name: "Files", exact: true })).toHaveAttribute("aria-expanded", "false");
    await viewer.getByRole("button", { name: "Files", exact: true }).click();
    await expect.poll(async () => Math.abs((await rail.boundingBox())!.width - resizedWidth)).toBeLessThan(2);
    await expect(viewer.getByTitle("Read src/index.ts")).toHaveAttribute("aria-current", "page");

    await dialog.getByRole("button", { name: "Enter focus reader" }).click();
    await expect(page.locator(".research-res-overlay")).toHaveAttribute("data-github-focus", "true");
    await expect(viewer.getByText('export const cave = "verified";', { exact: true })).toBeVisible();
    await capture(page, info, "focus");
    await page.keyboard.press("Escape");
    await expect(dialog.getByRole("button", { name: "Enter focus reader" })).toBeFocused();
    await expect(dialog).toBeVisible();
    expect(requests.blobUrls).toHaveLength(1);

    await viewer.getByText("Repository details", { exact: true }).click();
    await expect(viewer.getByText("MIT", { exact: true })).toBeVisible();
    await expect(viewer.getByText("842 / 61", { exact: true })).toBeVisible();
    await viewer.getByText("Repository details", { exact: true }).click();

    const actions = dialog.getByRole("button", { name: "Repository actions" });
    await actions.focus();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("menuitem", { name: "Copy repository URL" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(actions).toBeFocused();
    await expect(dialog).toBeVisible();
    await actions.click();
    await page.getByRole("menuitem", { name: "Remove from saves" }).click();
    await expect(dialog.getByRole("button", { name: "Remove save", exact: true })).toBeFocused();
    await dialog.getByRole("button", { name: "Keep", exact: true }).click();
    await expect(dialog.locator(".research-res-overlay__actions")).toHaveCount(0);

    await page.setViewportSize({ width: 640, height: 820 });
    const filesToggle = viewer.getByRole("button", { name: "Files" });
    await expect(filesToggle).toBeVisible();
    await expect(viewer.getByRole("navigation", { name: "Repository files" })).toBeHidden();
    await filesToggle.click();
    await expect(filesToggle).toHaveAttribute("aria-expanded", "true");
    await expect(viewer.getByRole("navigation", { name: "Repository files" })).toBeVisible();
    await expect(viewer.getByRole("button", { name: "Close file rail" })).toBeFocused();
    await search.fill("index");
    await page.keyboard.press("Escape");
    await expect(search).toHaveValue("");
    await expect(rail).toBeVisible();
    await capture(page, info, "narrow-files");
    await page.keyboard.press("Escape");
    await expect(viewer.getByRole("navigation", { name: "Repository files" })).toBeHidden();
    await expect(filesToggle).toBeFocused();

    await filesToggle.click();
    await viewer.getByRole("button", { name: "Close file rail" }).click();
    await expect(viewer.getByRole("navigation", { name: "Repository files" })).toBeHidden();
    await expect(filesToggle).toBeFocused();
    await expect(viewer.getByText("Tree listing truncated", { exact: true })).toBeVisible();
    await expect(viewer.locator(".research-gh__context time")).toBeVisible();
    await capture(page, info, "narrow");

    await page.setViewportSize({ width: 380, height: 760 });
    await expect(viewer.getByText("Tree listing truncated", { exact: true })).toBeVisible();
    await expect(viewer.locator(".research-gh__context time")).toBeVisible();
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await capture(page, info, "phone");
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect.poll(async () => Math.abs((await rail.boundingBox())!.width - resizedWidth)).toBeLessThan(2);
    await viewer.getByTitle("Read README.md").click();
    await page.evaluate(() => {
      document.documentElement.dataset.theme = "tide";
      document.documentElement.dataset.mode = "light";
    });
    await expect(viewer.getByRole("heading", { name: "Coven Cave" })).toBeVisible();
    const lightSurface = await viewer.locator(".research-gh__reader-head").evaluate((element) => getComputedStyle(element).backgroundColor);
    await expect.poll(() => viewer.locator(".ui-search-input").evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(lightSurface);
    await capture(page, info, "light");
    expect(requests.blobUrls).toHaveLength(1);
    await viewer.getByTitle("Read src/index.ts").click();
    await expect(viewer.getByText('export const cave = "verified";', { exact: true })).toBeVisible();
    expect(await documentBody.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(lightSurface);
    await capture(page, info, "light-source");
  });
});
