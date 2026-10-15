import { expect, test } from "@playwright/test";

import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const requirePackage = createRequire(join(process.cwd(), "package.json"));
let researchStyles: string[] = [];
try {
  const packageRoot = dirname(requirePackage.resolve("@opencoven/research/package.json"));
  researchStyles = [join(packageRoot, "dist/styles/globals/surface-research-prompt.css")];
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "MODULE_NOT_FOUND") throw error;
}

// Render the real controls without a daemon or application server. This catches
// CSS geometry regressions independently of workspace data and onboarding.
let controls: string;
const styles = [
  "src/styles/globals/foundations.css",
  "src/styles/globals/themes.css",
  "src/styles/globals/primitives.css",
  "src/styles/board/chrome-table.css",
  "src/styles/daily-report-shipped.css",
  "src/styles/journal.css",
  "src/styles/globals/desktop-chrome.css",
  "src/styles/globals/shared-pickers-and-toasts.css",
  ...researchStyles,
].map((file) => readFileSync(file, "utf8")).join("\n");

test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `
        import React, { useState } from "react";
        import { createRoot } from "react-dom/client";
        import { BoardTokenSearch } from "./src/components/board-token-search";
        import { SearchInput } from "./src/components/ui/search-input";
        function Controls() {
          const [query, setQuery] = useState("");
          const [shared, setShared] = useState("");
          return <main>
            <div className="board-shell"><BoardTokenSearch value={query} onChange={setQuery} familiars={[]} cards={[]} /></div>
            <SearchInput aria-label="Search resources" value={shared} onValueChange={setShared} onClear={() => setShared("")} />
          </main>;
        }
        createRoot(document.getElementById("root")).render(<Controls />);
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
  controls = result.outputFiles[0].text;
});

test.beforeEach(async ({ page }) => {
  await page.setContent(`<html data-theme="codex" data-mode="dark"><style>${styles}
    * { box-sizing:border-box; }
    main { width:240px; max-width:100%; }
    .board-shell { width:180px; height:auto; overflow:visible; }
    .sr-only { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0,0,0,0); }
  </style><div id="root"></div></html>`);
  await page.addScriptTag({ content: controls });
});

test("Tasks search stays on one row in narrow fields and phone layouts", async ({ page }) => {
  const search = page.getByRole("textbox", { name: "Search tasks", exact: true });
  await expect(search).toBeVisible({ timeout: 60_000 });

  // Reproduce the screenshot's constrained search slot without changing the
  // viewport: sidebar/split-pane layouts can leave only this much toolbar room.
  await page.locator(".board-token-search").evaluate((element) => {
    element.style.width = "180px";
    element.style.maxWidth = "180px";
  });
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await search.focus();
    const geometry = await page.locator(".board-token-field").evaluate((field) => {
      const input = field.querySelector("input")!;
      const icon = field.querySelector(".board-token-search-icon")!;
      const box = field.getBoundingClientRect();
      const text = input.getBoundingClientRect();
      const glyph = icon.getBoundingClientRect();
      return {
        height: box.height,
        inputWidth: text.width,
        centerDifference: Math.abs(text.y + text.height / 2 - glyph.y - glyph.height / 2),
        contained: text.left >= box.left && text.right <= box.right,
        fontSize: parseFloat(getComputedStyle(input).fontSize),
        outline: getComputedStyle(field).outlineStyle,
      };
    });
    expect(geometry.centerDifference).toBeLessThan(2);
    expect(geometry.inputWidth).toBeGreaterThan(90);
    expect(geometry.contained).toBe(true);
    expect(geometry.height).toBeLessThan(60);
    expect(geometry.outline).toBe("solid");
    if (width <= 767) {
      expect(geometry.height).toBeGreaterThanOrEqual(44);
      expect(geometry.fontSize).toBeGreaterThanOrEqual(16);
    }
  }

  await search.fill("is:open ");
  await expect(page.locator(".board-token-chip")).toHaveCount(1);
  await expect(search).toBeVisible();
  await search.fill("");
  await page.getByRole("button", { name: "Remove is filter" }).click();
  await expect(page.locator(".board-token-chip")).toHaveCount(0);
});


test("shared search contains its input and clears by button or Escape", async ({ page }) => {
  const search = page.getByRole("searchbox", { name: "Search resources" });
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await search.fill("query");
    const outer = await page.locator(".ui-search-input").boundingBox();
    const inner = await search.boundingBox();
    expect(outer).not.toBeNull();
    expect(inner).not.toBeNull();
    expect(inner!.y).toBeGreaterThanOrEqual(outer!.y);
    expect(inner!.y + inner!.height).toBeLessThanOrEqual(outer!.y + outer!.height);
    await page.getByRole("button", { name: "Clear search" }).click();
    await expect(search).toHaveValue("");
    await search.fill("again");
    await search.press("Escape");
    await expect(search).toHaveValue("");
  }
});


test("specialized native search fields retain touch sizing over surface styles", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  const fields = [
    "journal-list__filter",
    "drd-ship-search-input",
    "familiar-switcher__search",
    "cave-project-picker__filter",
    ...(researchStyles.length ? ["research-quick-saves__search"] : []),
  ];
  await page.locator("main").waitFor();
  await page.locator("main").evaluate((main, classes) => {
    for (const className of classes) {
      const input = document.createElement("input");
      input.className = `ui-search-field ${className}`;
      input.setAttribute("aria-label", className);
      main.append(input);
    }
  }, fields);
  for (const field of fields) {
    const geometry = await page.getByLabel(field).evaluate((input) => ({
      height: input.getBoundingClientRect().height,
      fontSize: parseFloat(getComputedStyle(input).fontSize),
    }));
    expect(geometry.height, field).toBeGreaterThanOrEqual(44);
    expect(geometry.fontSize, field).toBeGreaterThanOrEqual(16);
  }
});
