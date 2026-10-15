import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import { readFileSync } from "node:fs";

// Real reader components and styles, with synthetic content and no local data.
let reader: string;
const styles = [
  "src/styles/globals/foundations.css",
  "src/styles/globals/themes.css",
  "src/styles/globals/primitives.css",
  "src/styles/document-reader.css",
  "src/styles/chat-attachment-reader.css",
].map((file) => readFileSync(file, "utf8")).join("\n");

test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `
        import React from "react";
        import { createRoot } from "react-dom/client";
        import { DocumentReader } from "./src/components/document-reader";
        import { ReaderTable, ReaderCodeBlock } from "./src/components/document-reader-markdown";
        import { LiveRegionProvider } from "./src/components/ui/live-region";
        const document = {
          title: "Responsive reader sample",
          sections: [
            { id: "overview", heading: "Overview", level: 2, blocks: [{
              headers: ["Stage", "Owner", "Change", "Next step"],
              rows: Array.from({ length: 3 }, (_, i) => [
                "Stage " + (i + 1), "Sample team",
                "Prepare a clear, complete summary and review the proposed changes together.",
                "Confirm the review and schedule the next useful action.",
              ]),
            }] },
            { id: "data", heading: "Wide data", level: 2, blocks: [{
              headers: Array.from({ length: 12 }, (_, i) => "Column " + i),
              rows: [Array.from({ length: 12 }, (_, i) => "Value " + i)],
            }] },
            { id: "code", heading: "Code", level: 2, blocks: [{ code: "const sample = " + "readableValue".repeat(30) }] },
          ],
        };
        createRoot(window.document.getElementById("root")).render(
          <LiveRegionProvider><div className="chat-attachment-reader">
            <DocumentReader document={document} navigation="rail" collapsibleSections={false}
              renderBlock={(block) => block.code ? <ReaderCodeBlock code={block.code} /> : <ReaderTable {...block} />} />
          </div></LiveRegionProvider>
        );
      `,
      resolveDir: process.cwd(),
      loader: "tsx",
    },
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    tsconfig: "tsconfig.json",
    define: { "process.env.NODE_ENV": '"production"' },
  });
  reader = result.outputFiles[0].text;
});

test.beforeEach(async ({ page }) => {
  await page.setContent(`<html data-theme="coven" data-mode="dark"><style>${styles}
    * { box-sizing:border-box; }
    html,body { margin:0; background:var(--bg-base); color:var(--text-primary); font-family:system-ui; }
    .chat-attachment-reader,#root { height:850px; }
  </style><div id="root"></div></html>`);
  await page.evaluate(() => {
    window.fetch = async () => new Response(JSON.stringify({ ok: true, preferences: {} }), {
      headers: { "content-type": "application/json" },
    });
  });
  await page.addScriptTag({ content: reader });
  await expect(page.locator("table")).toHaveCount(2);
});

test("wide blocks fit the reading pane and prose tables wrap before overflowing", async ({ page }) => {
  for (const theme of ["coven", "codex"]) {
    for (const mode of ["dark", "light"]) {
      await page.evaluate(({ theme, mode }) => {
        Object.assign(document.documentElement.dataset, { theme, mode });
      }, { theme, mode });
      for (const width of [1800, 1200, 900, 600, 390, 320]) {
        await page.setViewportSize({ width, height: 900 });
        const geometry = await page.locator(".document-reader__scroll").evaluate((pane) => {
          const bounds = pane.getBoundingClientRect();
          return Array.from(pane.querySelectorAll<HTMLElement>(".document-reader__wide-block"), (block) => {
            const box = block.getBoundingClientRect();
            return {
              contained: box.left >= bounds.left - 1 && box.right <= bounds.right + 1,
              overflow: block.scrollWidth - block.clientWidth,
            };
          });
        });
        expect(geometry).toHaveLength(3);
        expect(geometry.every((block) => block.contained), `${theme}/${mode}/${width}`).toBe(true);
        if (width >= 900) expect(geometry[0].overflow).toBeLessThanOrEqual(1);
        expect(geometry[1].overflow).toBeGreaterThan(0);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      }
    }
  }
});

test("dense tables remain keyboard scrollable and code retains its wrap control", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  const table = page.getByRole("region", { name: "Scrollable table" }).last();
  await table.focus();
  await expect(table).toBeFocused();
  expect(await table.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe("solid");
  await table.press("ArrowRight");
  await expect.poll(() => table.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  await table.evaluate((element) => { element.scrollLeft = element.scrollWidth; });
  expect(await table.evaluate((element) => {
    const last = element.querySelector("th:last-child")!.getBoundingClientRect();
    const frame = element.getBoundingClientRect();
    return last.right <= frame.right + 1 && last.left >= frame.left;
  })).toBe(true);
  const pre = page.locator(".document-reader__code-frame pre");
  expect(await pre.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  await page.getByRole("button", { name: "Wrap code" }).click();
  await expect(page.getByRole("button", { name: "Wrap code" })).toHaveAttribute("aria-pressed", "true");
  expect(await pre.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
});
