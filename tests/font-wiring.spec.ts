import { expect, test } from "@playwright/test";
import { FAMILIES } from "../scripts/vendor-fonts.mjs";

// Vendored fonts (#5533): validate the emitted CSS in a real browser, not just
// the generated source. Every --font-* var must name families that real
// @font-face rules declare. A mismatch (vercel/next.js#88894: a custom
// font-family on next/font/local) silently renders everything in the fallback.

test("every font variable names declared families, and non-latin text loads its subset", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("cave:onboarding:dismissed", "1"));
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".shell-frame", { timeout: 30_000 });

  const report = await page.evaluate(async (variables) => {
    const unquote = (name: string) => name.trim().replace(/^["']|["']$/g, "").toLowerCase();
    const declared = new Map<string, FontFace[]>();
    for (const face of document.fonts) {
      const key = unquote(face.family);
      declared.set(key, [...(declared.get(key) ?? []), face]);
    }
    const style = getComputedStyle(document.documentElement);
    const problems: string[] = [];
    for (const variable of variables) {
      const stack = style.getPropertyValue(variable).split(",").map(unquote).filter(Boolean);
      if (stack.length < 2) problems.push(`${variable} is not a family stack: ${stack.join(", ")}`);
      // Every entry but the metric-adjusted fallback must be a vendored face.
      for (const family of stack.slice(0, -1)) {
        if (!declared.has(family)) problems.push(`${variable} names ${family}, which no @font-face declares`);
      }
      if (!stack.at(-1)?.endsWith(" fallback")) problems.push(`${variable} does not end in its fallback`);
    }

    // Inter's stack must include its cyrillic subset, and that face must load.
    // Load the face itself, not the whole stack: the stack ends in a metric
    // fallback declared as local(Arial), which Linux CI runners do not have.
    // (Browsers serialize the range without leading zeros: U+400-45F.)
    const interStack = style.getPropertyValue("--font-inter").split(",").map(unquote);
    const cyrillicFaces = [...document.fonts].filter(
      (face) => interStack.includes(unquote(face.family)) && /U\+0?400-0?45F/i.test(face.unicodeRange),
    );
    await Promise.all(cyrillicFaces.map((face) => face.load()));
    const cyrillic = cyrillicFaces.length > 0 && cyrillicFaces.every((face) => face.status === "loaded");
    return { problems, cyrillic, families: declared.size };
  }, FAMILIES.map((spec) => spec.variable));

  expect(report.problems).toEqual([]);
  expect(report.families, "vendored subset families are declared").toBeGreaterThan(FAMILIES.length);
  expect(report.cyrillic, "Cyrillic text loads the Inter cyrillic subset").toBe(true);
});
