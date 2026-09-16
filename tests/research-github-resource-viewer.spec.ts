import { expect, test, type Page } from "@playwright/test";

// Saved GitHub repository modal — the Research Desk → Resources detail view
// for a commit-pinned repository snapshot ("GitHub Repo Modal.dc.html"
// handoff, cave-3aww3).
//
// Daemon-less (COVEN_CAVE_E2E=1): every server truth is a page.route mock, so
// the snapshot the modal renders is exactly the one these fixtures describe.

const COMMIT_SHA = "a".repeat(40);
const README_SHA = "b".repeat(40);
const SOURCE_SHA = "c".repeat(40);
const DEEP_SHA = "d".repeat(40);
const IMAGE_SHA = "e".repeat(40);
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

// `vendor/deep/nest/only` is a single-child directory spine — the shape the
// rail's chain collapsing exists for.
const TREE = [
  { path: "README.md", type: "blob", sha: README_SHA, size: 128 },
  { path: "src", type: "tree", sha: COMMIT_SHA },
  { path: "src/index.ts", type: "blob", sha: SOURCE_SHA, size: 31 },
  { path: "vendor/deep/nest/only/Widget.swift", type: "blob", sha: DEEP_SHA, size: 90 },
  { path: "assets/logo.png", type: "blob", sha: IMAGE_SHA, size: 240_000 },
];

// The centred-header wrapper is the fidelity leak this redesign closes: it
// used to print as literal text in the reader.
const README_MD = [
  '<div align="center">',
  "",
  "# Coven Cave",
  "",
  "</div>",
  "",
  "A commit-pinned saved repository snapshot.",
].join("\n");

const SAVED_LINK_DETAIL = {
  ...SAVED_LINK,
  githubRepo: { ...GITHUB_SUMMARY, tree: TREE, readme: { path: "README.md", markdown: README_MD } },
};

type GithubRequests = {
  detailIds: string[];
  blobUrls: string[];
};

async function boot(
  page: Page,
  { truncated = false }: { truncated?: boolean } = {},
): Promise<GithubRequests> {
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
      return route.fulfill({
        json: {
          ok: true,
          link: truncated
            ? { ...SAVED_LINK_DETAIL, githubRepo: { ...SAVED_LINK_DETAIL.githubRepo, truncated: true } }
            : SAVED_LINK_DETAIL,
        },
      });
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

async function openModal(page: Page, options?: { truncated?: boolean }) {
  const requests = await boot(page, options);
  await page
    .locator(".research-res")
    .getByRole("button", { name: "OpenCoven/coven-cave — open details" })
    .click();
  const modal = page.getByRole("region", { name: "OpenCoven/coven-cave repository snapshot" });
  await expect(modal).toBeVisible();
  return { requests, modal };
}

/** A rail row, addressed the way the modal labels them: by full path. */
function row(modal: ReturnType<Page["locator"]>, path: string) {
  return modal.locator(`[role="treeitem"][title="${path}"]`);
}

test.describe("saved GitHub repository modal", () => {
  test.describe.configure({ timeout: 180_000 });

  test("loads persisted detail and reads an exact captured blob in Cave", async ({ page }) => {
    const { requests, modal } = await openModal(page);

    await expect.poll(() => requests.detailIds).toEqual([LINK_ID]);
    // Provenance is stated once, as the short SHA over the ref it resolved from.
    await expect(modal.locator(".research-gh__commit")).toContainText(
      `${COMMIT_SHA.slice(0, 7)}/main`,
    );
    await expect(modal.getByRole("heading", { name: "Coven Cave" })).toBeVisible();

    await row(modal, "src").click();
    await row(modal, "src/index.ts").click();

    await expect(modal.getByText('export const cave = "verified";', { exact: true })).toBeVisible();
    await expect.poll(() => requests.blobUrls).toHaveLength(1);
    const blobUrl = new URL(requests.blobUrls[0]);
    expect(blobUrl.pathname).toBe("/api/research/github-repo/file");
    expect(blobUrl.searchParams.get("repo")).toBe("OpenCoven/coven-cave");
    expect(blobUrl.searchParams.get("sha")).toBe(SOURCE_SHA);

    // Line numbers are always on, and the primary action follows the selection
    // rather than pointing at one fixed destination.
    await expect(modal.locator(".research-gh__line-no").first()).toHaveText("1");
    await expect(modal.locator(".research-gh__primary")).toHaveText(/Open index\.ts/);
  });

  test("states identity once and gives the freed height to the workspace", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 960 });
    const { modal } = await openModal(page);

    // The P0 this redesign exists for: the repo was named three times and the
    // domain twice before any content appeared.
    await expect(modal.locator(".research-gh__slug")).toHaveText("OpenCoven/coven-cave");
    await expect(modal.getByText("Saved GitHub repository")).toHaveCount(0);
    await expect(modal.locator(".research-gh__meta-url")).toContainText(
      "github.com/OpenCoven/coven-cave",
    );

    const meta = modal.locator(".research-gh__meta");
    await expect(meta).toContainText("TypeScript");
    await expect(meta).toContainText("MIT");
    await expect(meta.locator(".research-gh__metrics")).toContainText("842");
    // `public` is the default, so absence of a badge IS the information.
    await expect(modal.locator(".research-gh__exception")).toHaveCount(0);

    const modalBox = (await modal.boundingBox())!;
    const headBox = (await modal.locator(".research-gh__head").boundingBox())!;
    const footBox = (await modal.locator(".research-gh__actions").boundingBox())!;
    const workspaceBox = (await modal.locator(".research-gh__workspace").boundingBox())!;
    expect(headBox.height).toBeLessThan(130);
    expect(headBox.height + footBox.height).toBeLessThan(modalBox.height * 0.25);
    expect(workspaceBox.height).toBeGreaterThan(modalBox.height * 0.7);
  });

  test("a single-child directory spine is one row, and the filter finds files by name", async ({ page }) => {
    const { modal } = await openModal(page);

    // Four levels of spine collapse into one row carrying the joined path.
    await expect(row(modal, "vendor/deep/nest/only")).toHaveCount(1);
    await expect(row(modal, "vendor")).toHaveCount(0);
    await expect(row(modal, "vendor/deep")).toHaveCount(0);

    const filter = modal.getByLabel("Filter repository files");
    await filter.fill("widget");
    const rows = modal.locator('[role="treeitem"]');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("Widget.swift");
    // A filter row never wraps: one row per item is the rail's whole contract.
    expect((await rows.first().boundingBox())!.height).toBeLessThan(34);

    // Escape clears the filter before it ever reaches the dialog.
    await filter.press("Escape");
    await expect(filter).toHaveValue("");
    await expect(modal).toBeVisible();
  });

  test("refuses an unpreviewable file in-pane and keeps README layout HTML out of the prose", async ({ page }) => {
    const { requests, modal } = await openModal(page);

    // The captured README's centred-header wrapper is stripped, not escaped.
    const content = modal.locator(".research-gh__content");
    await expect(content).toContainText("A commit-pinned saved repository snapshot.");
    await expect(content).not.toContainText("<div");
    await expect(content).not.toContainText("</div>");

    await modal.getByLabel("Filter repository files").fill("logo.png");
    await modal.locator('[role="treeitem"]').first().click();

    await expect(content).toContainText("not previewable in Cave");
    await expect(content).toContainText("234 KB");
    // Asking GitHub for bytes Cave will refuse to render is wasted work.
    await expect.poll(() => requests.blobUrls).toHaveLength(0);
  });

  test("a truncated capture states the count and offers the rest on GitHub", async ({ page }) => {
    const { modal } = await openModal(page, { truncated: true });
    const band = modal.locator(".research-gh__truncated");
    await expect(band).toContainText("GitHub truncated this tree at capture");
    await expect(band.getByRole("button", { name: /Browse the rest on GitHub/ })).toBeVisible();
  });

  test("the rail collapses, and the shortcuts sheet closes without closing the modal", async ({ page }) => {
    const { modal } = await openModal(page);

    await expect(modal.locator(".research-gh__rail")).toBeVisible();
    await modal.locator(".research-gh__rail-head").click();
    await expect(modal.locator(".research-gh__rail")).toHaveCount(0);
    await expect(modal.locator(".research-gh__rail-stub")).toBeVisible();

    await modal.locator(".research-gh__rail-stub").click();
    await expect(modal.locator(".research-gh__rail")).toBeVisible();

    // Esc is layered — help, then menu, then filter, then the modal — so it
    // never closes more than the user asked it to.
    await page.keyboard.press("?");
    await expect(modal.locator(".research-gh__help")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(modal.locator(".research-gh__help")).toHaveCount(0);
    await expect(modal).toBeVisible();
  });
});
