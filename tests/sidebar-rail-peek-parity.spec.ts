import { expect, test, type Page } from "@playwright/test";

// Issue 4351 — "Sidebar feels off due to change in position of buttons when
// hovering". Hovering the collapsed 56px nav rail floats the panel open as an
// overlay (hover-peek), and every control used to move: 8px right, because the
// rail centres 32px squares while the panel left-aligns rows, and 88-108px up,
// because the rail carried a brand mark and an account avatar the panel has no
// counterpart for. The footer was worst — its buttons sit in a row in the panel
// and a stack in the rail, so Settings travelled 138px.
//
// The contract this spec measures: collapsing a control changes its WIDTH and
// nothing else. Same icon column, same box left edge, same order.
//
// Daemon-less: onboarding dismissed, no /api mocks needed — the rail is chrome
// and renders before any data arrives.

const RAIL = ".shell-nav--rail";
const PEEK = ".shell-nav--peek";

// Every control that exists in BOTH states, keyed by DOM order so the same
// element is compared across the two renders (it is the same component; only
// the class on the <aside> changes).
const CONTROLS = [
  ".rail-header__scope .familiar-switcher__trigger",
  ".rail-header__new",
  ".sidebar-folder-row",
  ".sidebar-foot-btn",
] as const;

type Probe = { left: number; iconCx: number; iconCy: number };

async function probe(page: Page, scope: string): Promise<Record<string, Probe[]>> {
  return page.evaluate((sel) => {
    const out: Record<string, { left: number; iconCx: number; iconCy: number }[]> = {};
    for (const selector of sel.controls) {
      out[selector] = [...document.querySelectorAll(`${sel.scope} ${selector}`)].map((el) => {
        const box = el.getBoundingClientRect();
        // The glyph, not the box, is what the eye tracks across the transition.
        const glyph = el.querySelector("svg, img");
        const g = glyph ? glyph.getBoundingClientRect() : box;
        return {
          left: Math.round(box.x),
          iconCx: Math.round(g.x + g.width / 2),
          iconCy: Math.round(g.y + g.height / 2),
        };
      });
    }
    return out;
  }, { scope, controls: [...CONTROLS] });
}

async function railThenPeek(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("cave:onboarding:dismissed", "1");
    window.localStorage.setItem("cave:shell:nav-open", "0");
  });
  await page.goto("/?demo=1");
  await expect(page.locator(RAIL)).toBeVisible();
  const rail = await probe(page, RAIL);

  // Hover-peek: the aside swaps --rail for --peek without changing collapse state.
  await page.locator(RAIL).hover();
  await expect(page.locator(PEEK)).toBeVisible();
  const peek = await probe(page, PEEK);
  return { rail, peek };
}

test("hover-peek keeps every rail control on the same icon column", async ({ page }) => {
  const { rail, peek } = await railThenPeek(page);

  for (const selector of CONTROLS) {
    expect(rail[selector].length, `${selector} renders in the collapsed rail`).toBeGreaterThan(0);
    expect(peek[selector].length, `${selector} keeps its count on peek`).toBe(rail[selector].length);

    rail[selector].forEach((before, i) => {
      const after = peek[selector][i];
      // 1px of tolerance for sub-pixel glyph widths, not for a layout shift.
      expect(
        Math.abs(after.iconCx - before.iconCx),
        `${selector}[${i}] glyph stays on the icon column (rail ${before.iconCx} → peek ${after.iconCx})`,
      ).toBeLessThanOrEqual(1);
      expect(
        Math.abs(after.left - before.left),
        `${selector}[${i}] box keeps its left edge (rail ${before.left} → peek ${after.left})`,
      ).toBeLessThanOrEqual(1);
    });
  }
});

test("the rail carries no control the expanded panel lacks", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("cave:onboarding:dismissed", "1");
    window.localStorage.setItem("cave:shell:nav-open", "0");
  });
  await page.goto("/?demo=1");
  await expect(page.locator(RAIL)).toBeVisible();

  // The two retired rail-only bookends. Both had no panel counterpart, and the
  // account avatar's only action duplicated the Settings button above it.
  await expect(page.locator(".sidebar-brand-mark")).toHaveCount(0);
  await expect(page.locator(".sidebar-user-avatar")).toHaveCount(0);
  // The version line stays: it is the nav's bottom band, so hiding it in the
  // rail alone moved the footer buttons across the transition.
  await expect(page.locator(`${RAIL} .sidebar-version`)).toBeVisible();
});

test("hover-peek leaves the footer band where it was", async ({ page }) => {
  const { rail, peek } = await railThenPeek(page);
  const railFoot = rail[".sidebar-foot-btn"];
  const peekFoot = peek[".sidebar-foot-btn"];

  expect(railFoot.length).toBeGreaterThan(0);
  // The footer is bottom-anchored, so unlike the scrolling nav list it can hold
  // its vertical position too — this is the assertion that would have failed
  // hardest before the fix (Dashboard moved 39px right and 67px down, Settings
  // 138px right). The nav list above still shifts by the one control whose rail
  // form is a different SHAPE — the stacked Home/Chat section tabs — which is
  // under one row's pitch and documented on .shell-nav in shell-navigation.css.
  railFoot.forEach((before, i) => {
    expect(
      Math.abs(peekFoot[i].iconCx - before.iconCx),
      `footer[${i}] holds its column`,
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(peekFoot[i].iconCy - before.iconCy),
      `footer[${i}] holds its height`,
    ).toBeLessThanOrEqual(2);
  });
});
