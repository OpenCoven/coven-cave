import { expect, test } from "@playwright/test";
import { openFirstProjectGate } from "../fixtures/first-project-gate";

// #5528: on a phone the mobile chat chrome used to cover the gate's title and
// its Create button. Each must own the pixel at its own centre, the device's
// own height and a taller 390×844 frame alike.

for (const height of [undefined, 844] as const) {
  test(`the gate's title and Create stay reachable${height ? ` at ${height}px` : ""}`, async ({ page }) => {
    test.setTimeout(120_000);
    if (height) await page.setViewportSize({ width: 390, height });
    const gate = await openFirstProjectGate(page);
    await gate.getByLabel("Project name").fill("Demo");
    await gate.getByLabel("Absolute root").fill("/tmp/demo");

    const create = gate.getByRole("button", { name: "Create" });
    await create.scrollIntoViewIfNeeded();
    for (const [label, target] of [
      ["title", gate.getByRole("heading", { name: "Create your first project" })],
      ["Create", create],
    ] as const) {
      const box = await target.boundingBox();
      if (!box) throw new Error(`${label} did not lay out`);
      const owns = await target.evaluate(
        (element, point) => {
          const hit = document.elementFromPoint(point.x, point.y);
          return !!hit && (hit === element || element.contains(hit));
        },
        { x: box.x + box.width / 2, y: box.y + box.height / 2 },
      );
      expect(owns, `${label} does not own its own centre`).toBe(true);
    }
    await expect(create).toBeEnabled();
  });
}
