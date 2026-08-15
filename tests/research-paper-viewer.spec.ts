import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

// Research paper viewer (cave-cbz28) — an ingested arXiv paper reads inside the
// Resources detail overlay: pdf.js paints the page to a <canvas> and builds a
// selectable text layer over it.
//
// Daemon-less (COVEN_CAVE_E2E=1), so every server truth is a page.route mock —
// including BOTH routes this feature added: /api/research/links (which now
// carries a `paper` block) and /api/research/papers/pdf (which streams the
// bytes). PR #4634 shipped a new route plus a conditional viewer without
// mocking the route, the viewer stopped rendering, and main went red for hours
// (cave-1kv8i). This feature has the same shape, so its e2e ships with it.
//
// The fixture is a real one-page PDF, not a stub body: pdf.js parses what it is
// handed, so `%PDF-1.4 fake` would fail at the parser and prove nothing about
// the viewer. Its visible text is HYPERSPECTRAL FIXTURE, which is what the text
// layer assertion looks for — a canvas alone only proves a picture painted.

const FAMILIAR_ID = "rida";
const ARXIV_ID = "2401.12345";
const FIXTURE_TEXT = "HYPERSPECTRAL FIXTURE";
const SAMPLE_PDF = readFileSync(
  fileURLToPath(new URL("./fixtures/sample-paper.pdf", import.meta.url)),
);

// MediaBox of the fixture, which is what the viewer's default 100% zoom maps
// one-to-one onto the canvas' CSS box.
const PAGE_CSS_WIDTH = 612;
const PAGE_CSS_HEIGHT = 792;

const SAVED_LINK = {
  id: "l1",
  url: "https://huggingface.co/papers/2401.12345",
  category: "paper",
  title: "Fixture Paper",
  addedAt: new Date().toISOString(),
  source: "desk",
  paper: {
    arxivId: ARXIV_ID,
    authors: ["A. Author"],
    abstract: "An abstract for the fixture.",
    publishedAt: "2024-01-22T00:00:00.000Z",
  },
};

type PdfRequest = { url: string; ids: string[] };

async function boot(page: Page): Promise<PdfRequest> {
  const pdfRequests: PdfRequest = { url: "", ids: [] };

  await page.addInitScript(() => {
    window.localStorage.setItem("cave:onboarding:dismissed", "1");
    window.localStorage.setItem("cave:active-familiar", "rida");
  });
  await page.route("**/api/familiars**", (route) =>
    route.fulfill({
      json: {
        ok: true,
        familiars: [
          // The role label is what grants the researcher token, which is what
          // makes surface:researcher-desk reachable for this familiar.
          {
            id: FAMILIAR_ID,
            display_name: "Rida",
            role: "Researcher",
            status: "active",
            icon: "ph:sparkle-fill",
          },
        ],
      },
    }),
  );
  await page.route("**/api/sessions/list**", (route) =>
    route.fulfill({ json: { ok: true, sessions: [] } }),
  );
  await page.route(/\/api\/roles(?:\?|$)/, (route) =>
    route.fulfill({ json: { roles: [] } }),
  );
  await page.route(/\/api\/research\/missions\?/, (route) =>
    route.fulfill({ json: { ok: true, missions: [] } }),
  );
  await page.route(/\/api\/research\/generations/, (route) =>
    route.fulfill({ json: { ok: true, generations: [] } }),
  );
  // Route 1 of 2: the saved link now carries the arXiv metadata block, which is
  // the only thing that mounts the viewer at all.
  await page.route("**/api/research/links", (route) =>
    route.fulfill({ json: { ok: true, links: [SAVED_LINK] } }),
  );
  // Route 2 of 2: the same-origin PDF stream. No accept-ranges header, so
  // pdf.js takes the whole body in one fetch rather than issuing range probes.
  await page.route("**/api/research/papers/pdf**", async (route) => {
    const url = new URL(route.request().url());
    pdfRequests.url = url.pathname + url.search;
    pdfRequests.ids.push(url.searchParams.get("id") ?? "");
    await route.fulfill({
      status: 200,
      contentType: "application/pdf",
      body: SAMPLE_PDF,
    });
  });

  await page.goto("/");
  await page.getByRole("navigation").first().waitFor({ timeout: 60_000 });
  // A cold `next dev` compile can lose the navigate event to a race; re-fire
  // until the surface mounts (the pattern the other research specs use).
  await expect(async () => {
    await page.evaluate(() =>
      window.dispatchEvent(
        new CustomEvent("cave:navigate-mode", {
          detail: { mode: "surface:researcher-desk" },
        }),
      ),
    );
    await expect(page.locator(".research-desk")).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 90_000 });
  await page
    .getByRole("tablist", { name: "Research desk views" })
    .getByRole("tab", { name: /^Resources/ })
    .click();

  return pdfRequests;
}

test.describe("research paper viewer", () => {
  // Boot cost dominates: page load, the role-surface chunk compile, and then
  // pdf.js booting a worker and parsing before anything paints.
  test.describe.configure({ timeout: 180_000 });

  test("renders an ingested paper's page canvas and selectable text layer", async ({
    page,
  }) => {
    const pdfRequests = await boot(page);

    await page
      .locator(".research-res")
      .getByRole("button", { name: /Fixture Paper — open details/ })
      .click();

    const overlay = page.getByRole("dialog", { name: "Fixture Paper" });
    await expect(overlay).toBeVisible();
    await expect(overlay.locator(".research-res-overlay__sub")).toHaveText(
      "huggingface.co",
    );

    // The viewer is behind an explicit affordance: opening a paper's details
    // to read what sits below the stage must not pull the pdfjs chunk and a
    // multi-megabyte document nobody asked for. So nothing renders until this
    // is pressed — and no PDF is requested either, asserted below.
    await expect(overlay.getByRole("region", { name: "Paper" })).toHaveCount(0);
    expect(pdfRequests.ids).toHaveLength(0);
    await overlay.getByRole("button", { name: "Read" }).click();

    // The metadata the ingest resolved reads above the page itself.
    const viewer = overlay.getByRole("region", { name: "Paper" });
    await expect(viewer.locator(".research-paper-view__authors")).toHaveText(
      "A. Author",
    );
    await expect(viewer.locator(".research-paper-view__abstract")).toContainText(
      "An abstract for the fixture.",
    );

    // pdf.js reached the route with the ingested id, not the raw saved URL.
    await expect
      .poll(() => pdfRequests.ids, { timeout: 60_000 })
      .toContain(ARXIV_ID);

    // The document parsed: the reducer only leaves `loading` on a real
    // getDocument resolve, and the readout carries the parsed page count.
    const stage = viewer.locator(".research-paper-view__stage");
    await expect(stage).toHaveAttribute("data-status", "ready", {
      timeout: 60_000,
    });
    await expect(
      viewer.locator(".research-paper-view__readout").first(),
    ).toHaveText("Page 1 of 1");

    // The page painted: the canvas is sized from the real viewport (the
    // fixture's 612×792 MediaBox at 100% zoom) rather than the 300×150 default,
    // and its backing store holds non-blank pixels.
    const canvas = viewer.locator("canvas.research-paper-view__canvas");
    await expect(canvas).toBeVisible();
    await expect
      .poll(
        () =>
          canvas.evaluate((node: HTMLCanvasElement) => {
            // The component multiplies the backing store by the device pixel
            // ratio (capped at 2×), so divide it back out rather than pinning
            // the assertion to one runner's screen density.
            const output = Math.min(window.devicePixelRatio || 1, 2);
            return {
              cssWidth: node.style.width,
              cssHeight: node.style.height,
              backingWidth: node.width / output,
              backingHeight: node.height / output,
            };
          }),
        { timeout: 60_000 },
      )
      .toEqual({
        cssWidth: `${PAGE_CSS_WIDTH}px`,
        cssHeight: `${PAGE_CSS_HEIGHT}px`,
        backingWidth: PAGE_CSS_WIDTH,
        backingHeight: PAGE_CSS_HEIGHT,
      });
    const painted = await canvas.evaluate((node: HTMLCanvasElement) => {
      const context = node.getContext("2d");
      if (!context) return 0;
      const { data } = context.getImageData(0, 0, node.width, node.height);
      let marked = 0;
      // Count pixels that are neither transparent nor the page's white fill —
      // ink, which is what proves a render rather than a cleared canvas.
      for (let index = 0; index < data.length; index += 4) {
        const [r, g, b, a] = [
          data[index],
          data[index + 1],
          data[index + 2],
          data[index + 3],
        ];
        if (a > 0 && (r < 200 || g < 200 || b < 200)) marked += 1;
      }
      return marked;
    });
    expect(painted).toBeGreaterThan(0);

    // The text layer carries the fixture's words, which is what selection and
    // in-page search have to work with — a canvas alone is a picture of a paper.
    await expect(viewer.locator(".research-paper-view__text")).toContainText(
      FIXTURE_TEXT,
      { timeout: 60_000 },
    );

    // Single-page fixture: paging is honestly bounded by the parsed count.
    await expect(viewer.getByRole("button", { name: "Prev" })).toBeDisabled();
    await expect(viewer.getByRole("button", { name: "Next" })).toBeDisabled();
  });

  test("re-renders the page at a larger zoom stop", async ({ page }) => {
    await boot(page);

    await page
      .locator(".research-res")
      .getByRole("button", { name: /Fixture Paper — open details/ })
      .click();
    const overlay = page.getByRole("dialog", { name: "Fixture Paper" });
    await overlay.getByRole("button", { name: "Read" }).click();
    const viewer = overlay.getByRole("region", { name: "Paper" });
    const canvas = viewer.locator("canvas.research-paper-view__canvas");
    await expect(viewer.locator(".research-paper-view__stage")).toHaveAttribute(
      "data-status",
      "ready",
      { timeout: 60_000 },
    );
    await expect(viewer.locator(".research-paper-view__text")).toContainText(
      FIXTURE_TEXT,
      { timeout: 60_000 },
    );

    await viewer.getByRole("button", { name: "Zoom in" }).click();
    await expect(
      viewer.locator(".research-paper-view__readout").last(),
    ).toHaveText("125%");
    // The zoom stop re-renders at the new scale — and the text layer is rebuilt
    // with it, so selection stays aligned with what is drawn.
    await expect
      .poll(() => canvas.evaluate((node: HTMLCanvasElement) => node.style.width), {
        timeout: 60_000,
      })
      .toBe(`${Math.floor(PAGE_CSS_WIDTH * 1.25)}px`);
    await expect(viewer.locator(".research-paper-view__text")).toContainText(
      FIXTURE_TEXT,
      { timeout: 60_000 },
    );
  });
});
