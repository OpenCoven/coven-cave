import { expect, test, type Locator } from "@playwright/test";
import { openFirstProjectGate } from "../fixtures/first-project-gate";

// #5528: on a phone the mobile chat chrome used to cover the gate's title and
// its Create button. Each must own the pixel at its own centre, the device's
// own height and a taller 390×844 frame alike.

async function expectOwnsCentre(target: Locator, label: string) {
  const box = await target.boundingBox();
  if (!box) throw new Error(`${label} did not lay out`);
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
  expect(hit.owns, `${label} at y ${Math.round(box.y)} is covered by ${hit.covering}`).toBe(true);
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
    await create.scrollIntoViewIfNeeded();
    await expectOwnsCentre(create, "Create");
    await expect(create).toBeEnabled();
  });
}
