import { expect, test, type Page } from "@playwright/test";
import { BUILT_IN_WORKSPACE_PAGE_IDS } from "../src/lib/workspace-page-registry";

const PAGES = [...BUILT_IN_WORKSPACE_PAGE_IDS, "surface:researcher-desk"] as const;

function referencePage(pageId: string): string {
  return pageId === "home" ? "board" : "home";
}

async function openSplit(
  page: Page,
  primary: string,
  secondary: string,
  secondarySide: "left" | "right",
) {
  await page.goto(
    `/?demo=1&mode=${encodeURIComponent(primary)}&split=${encodeURIComponent(secondary)}&splitSide=${secondarySide}`,
    { waitUntil: "domcontentloaded", timeout: 60_000 },
  );
  await expect(page.locator(".split-host__group")).toBeVisible({ timeout: 60_000 });
}

async function expectWasteFreeHalves(page: Page) {
  const geometry = await page.locator(".split-host__group").evaluate((host) => {
    const hostRect = host.getBoundingClientRect();
    const panels = Array.from(host.querySelectorAll<HTMLElement>(":scope > [data-panel]"))
      .map((panel) => panel.getBoundingClientRect());
    const separator = host.querySelector<HTMLElement>(".split-host__sep")?.getBoundingClientRect();
    const paneRoots = Array.from(host.querySelectorAll<HTMLElement>(".workspace-pane-page"))
      .map((root) => root.getBoundingClientRect());
    return {
      host: hostRect,
      panels,
      separator,
      paneRoots,
    };
  });

  expect(geometry.panels).toHaveLength(2);
  expect(geometry.separator).toBeTruthy();
  expect(Math.abs(geometry.panels[0]!.width - geometry.panels[1]!.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(geometry.panels[0]!.left - geometry.host.left)).toBeLessThanOrEqual(1);
  expect(Math.abs(geometry.panels[1]!.right - geometry.host.right)).toBeLessThanOrEqual(1);
  expect(
    Math.abs(
      geometry.panels[0]!.width + geometry.separator!.width + geometry.panels[1]!.width
        - geometry.host.width,
    ),
  ).toBeLessThanOrEqual(1);
  expect(geometry.paneRoots).toHaveLength(2);
  for (const root of geometry.paneRoots) {
    expect(root.width).toBeGreaterThan(0);
    expect(root.height).toBeGreaterThan(0);
  }
}

for (const pageId of PAGES) {
  test(`${pageId} fills either desktop split half`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(() => {
      window.localStorage.setItem("cave:onboarding:dismissed", "1");
    });

    const reference = referencePage(pageId);
    for (const [primary, secondary] of [[pageId, reference], [reference, pageId]] as const) {
      for (const secondarySide of ["left", "right"] as const) {
        await test.step(`${pageId}: ${primary} / ${secondary} (${secondarySide})`, async () => {
          await openSplit(page, primary, secondary, secondarySide);
          await expectWasteFreeHalves(page);
        });
      }
    }
  });
}
