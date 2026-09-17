import { expect, test, type Page } from "@playwright/test";

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
  truncated: false,
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
    ],
    readme: {
      path: "README.md",
      markdown: "# Coven Cave\n\nA commit-pinned saved repository snapshot.",
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

test.describe("saved GitHub repository viewer", () => {
  test.describe.configure({ timeout: 180_000 });

  test("loads persisted detail and reads an exact captured blob in Cave", async ({ page }) => {
    const requests = await boot(page);
    await page
      .locator(".research-res")
      .getByRole("button", { name: "OpenCoven/coven-cave — open details" })
      .click();

    const viewer = page.getByRole("region", {
      name: "OpenCoven/coven-cave repository",
    });
    await expect(viewer).toBeVisible();
    await expect.poll(() => requests.detailIds).toEqual([LINK_ID]);
    await expect(viewer.getByText(COMMIT_SHA.slice(0, 12), { exact: true })).toBeVisible();
    await expect(viewer.getByRole("heading", { name: "Coven Cave" })).toBeVisible();

    await viewer.locator("summary.research-gh__dir-summary", { hasText: "src" }).click();
    await viewer.getByTitle("Read src/index.ts").click();

    await expect(viewer.getByText('export const cave = "verified";', { exact: true })).toBeVisible();
    await expect.poll(() => requests.blobUrls).toHaveLength(1);
    const blobUrl = new URL(requests.blobUrls[0]);
    expect(blobUrl.pathname).toBe("/api/research/github-repo/file");
    expect(blobUrl.searchParams.get("repo")).toBe("OpenCoven/coven-cave");
    expect(blobUrl.searchParams.get("sha")).toBe(SOURCE_SHA);
  });
});
