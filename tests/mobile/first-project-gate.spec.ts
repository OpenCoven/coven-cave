import { expect, test, type Locator } from "@playwright/test";
import { openFirstProjectGate } from "../fixtures/first-project-gate";

// #5528: on a phone the mobile chat chrome used to cover the gate's title and
// its Create button. Each must own the pixel at its own centre, the device's
// own height and a taller 390×844 frame alike.

/** The element at the target's own centre is the target (or inside it).
 *  The whole measurement is retried for a few seconds: on WebKit in CI the
 *  gate can still reflow (project loading states) or finish scrolling after a
 *  single read, so one snapshot flakes. It passes only after two consecutive
 *  owning reads, so a transient pass mid-reflow can't hide a target that ends
 *  up covered. A target that stays covered still fails, naming what covers it.
 *  `prepare` re-runs before each attempt (e.g. to scroll the target into view
 *  again). */
async function expectOwnsCentre(target: Locator, label: string, prepare?: () => Promise<void>) {
  let last = "was never measured";
  let owningReads = 0;
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (prepare) await prepare();
    const box = await target.boundingBox();
    if (box) {
      const hit = await target.evaluate(
        (element, point) => {
          const top = document.elementFromPoint(point.x, point.y);
          return {
            owns: !!top && (top === element || element.contains(top)),
            covering: top ? `${top.tagName.toLowerCase()}.${String((top as HTMLElement).className).slice(0, 80)}` : "none",
          };
        },
        { x: box.x + box.width / 2, y: box.y + box.height / 2 },
      );
      if (hit.owns) {
        owningReads += 1;
        if (owningReads >= 2) return;
      } else {
        owningReads = 0;
        last = `at y ${Math.round(box.y)} is covered by ${hit.covering}`;
      }
    } else {
      owningReads = 0;
      last = "has no layout box";
    }
    await target.page().waitForTimeout(150);
  }
  expect(false, `${label} ${last}`).toBe(true);
}

for (const height of [undefined, 844] as const) {
  test(`the gate's title and Create stay reachable${height ? ` at ${height}px` : ""}`, async ({ page }) => {
    test.setTimeout(120_000);
    if (height) await page.setViewportSize({ width: 390, height });
    const gate = await openFirstProjectGate(page);

    // The gate scrolls when it's taller than the space left between the shell
    // chrome (and any banner) and the bottom tabs, so the title is checked as
    // the gate opens and Create once it's scrolled into view.
    await expectOwnsCentre(gate.getByRole("heading", { name: "Create your first project" }), "title");

    await gate.getByLabel("Project name").fill("Demo");
    await gate.getByLabel("Absolute root").fill("/tmp/demo");
    const create = gate.getByRole("button", { name: "Create" });
    // scrollIntoViewIfNeeded leaves a partly visible button where it is (half
    // under the bottom tabs); centre it inside the scrolling gate instead, and
    // again on each attempt in case the gate was still growing.
    await expectOwnsCentre(create, "Create", () =>
      create.evaluate((element) => element.scrollIntoView({ block: "center" })),
    );
    await expect(create).toBeEnabled();
  });
}
