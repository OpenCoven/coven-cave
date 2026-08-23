import { expect, test, type Page } from "@playwright/test";

/**
 * cave-lcxc6 — a transient toast must never steal a persistent control's hit
 * area.
 *
 * The toast stack was a `fixed top-4 right-4 z-50` column at a desktop width
 * (`w-80`, 320px). On a 390-393px viewport it landed directly over the shell's
 * top-right "Open Chat panel" toggle: measured x 57..377 / y 17..156 against a
 * toggle at x 353..381 / y 12..40, leaving a ~4px sliver. `elementFromPoint` at
 * the toggle's own centre returned the toast card, so a real user could not tap
 * the toggle while a toast was up (and the e2e suite burned a 60s budget across
 * ~53 retried clicks, because every retry re-entered the card and re-paused its
 * auto-dismiss).
 *
 * It runs at desktop width too, and not as a formality: the same probe at
 * 1280px returned the card as well. The desktop `.shell-top` band is 34px and
 * the stack started at 16px, so the toggle's top half was reachable and its
 * centre — where a click lands — was not.
 *
 * The decisive probe is geometric, not "is the toggle visible": the toggle is
 * perfectly visible underneath. Both directions are asserted, because the two
 * cheap wrong fixes each break one of them — moving the toggle above the toast
 * strands the toast's own buttons, and blanket `pointer-events: none` on the
 * card leaves it undismissable.
 */

const FAMILIARS = [
  { id: "cody", display_name: "Cody", role: "Implementer", status: "active", icon: "ph:code" },
];

const MILESTONE_ITEM = {
  id: "toast-clearance-milestone",
  kind: "milestone",
  title: "Mission complete — Full roster at work",
  body: "Every familiar has run a working. Nobody is standing idle. +20 renown.",
  status: "fired",
  createdAt: "2026-08-22T00:00:00.000Z",
  updatedAt: "2026-08-22T00:00:00.000Z",
  firedAt: "2026-08-22T00:00:00.000Z",
  recurrence: { type: "none" },
  source: "system",
};

async function boot(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("cave:onboarding:dismissed", "1");
    localStorage.setItem("cave:active-familiar", "cody");
    localStorage.setItem("cave:shell:right-chat-open", "0");
  });
  await page.route("**/api/familiars**", (route) =>
    route.fulfill({ json: { ok: true, familiars: FAMILIARS } }),
  );
  await page.route("**/api/sessions/list**", (route) =>
    route.fulfill({ json: { ok: true, sessions: [] } }),
  );
  // Drive the toast deterministically rather than waiting for the milestone
  // watcher to happen to award one — that accident is exactly what made the
  // original failure flaky. EventSource reconnects after the stream closes, so
  // only the first request carries the event; later ones hang open.
  let streamed = false;
  await page.route("**/api/inbox/stream**", async (route) => {
    if (streamed) return route.fulfill({ status: 204, body: "" });
    streamed = true;
    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
      body:
        `data: ${JSON.stringify({ type: "snapshot", items: [] })}\n\n` +
        `data: ${JSON.stringify({ type: "created", item: MILESTONE_ITEM })}\n\n`,
    });
  });
  await page.goto("/");
  await page.waitForSelector(".shell-frame", { timeout: 30_000 });
}

const TOAST = '[role="status"]';

/** Topmost element at a point, plus a description for the failure message. */
async function hitTest(page: Page, x: number, y: number, selector: string) {
  return page.evaluate(
    ({ x, y, selector }) => {
      const el = document.elementFromPoint(x, y);
      return {
        matched: !!el?.closest(selector),
        describe: el ? `${el.tagName}.${el.className}`.slice(0, 160) : "none",
      };
    },
    { x, y, selector },
  );
}

// The two tests are deliberately short and separate rather than one journey:
// the card auto-hides after 8s (AUTO_DISMISS_MS), so a single test that walked
// the drawer open and closed before reaching the dismiss button would be
// racing that timer on a loaded runner.

test("a toast leaves the shell's top-right Chat toggle usable", async ({ page }, testInfo) => {
  await boot(page);

  const toggle = page.getByRole("button", { name: "Open Chat panel" });
  await expect(toggle).toBeVisible();
  const toast = page.locator(TOAST, { hasText: "Mission complete" }).first();
  await expect(toast).toBeVisible({ timeout: 30_000 });

  const toggleBox = await toggle.boundingBox();
  const toastBox = await toast.boundingBox();
  if (!toggleBox || !toastBox) throw new Error("toggle or toast did not lay out");
  // Recorded so a regression reads as geometry rather than a bare boolean.
  testInfo.annotations.push({
    type: "geometry",
    description:
      `toast x ${Math.round(toastBox.x)}..${Math.round(toastBox.x + toastBox.width)}` +
      ` y ${Math.round(toastBox.y)}..${Math.round(toastBox.y + toastBox.height)}` +
      ` | toggle x ${Math.round(toggleBox.x)}..${Math.round(toggleBox.x + toggleBox.width)}` +
      ` y ${Math.round(toggleBox.y)}..${Math.round(toggleBox.y + toggleBox.height)}`,
  });

  // Visibility is not the question — the toggle was always visible underneath.
  // The question is which element owns the pixel a finger lands on.
  const hit = await hitTest(
    page,
    toggleBox.x + toggleBox.width / 2,
    toggleBox.y + toggleBox.height / 2,
    ".shell-top-toggle--right",
  );
  expect(hit.matched, `elementFromPoint at the toggle centre resolved to ${hit.describe}`).toBe(
    true,
  );

  // …and it really actuates, with no `force`. Assert via the toggle's own
  // accessible name rather than the panel it opens: mobile opens a dialog and
  // desktop a persistent panel, but the control reads the same on both.
  await toggle.click();
  await expect(page.getByRole("button", { name: "Close Chat panel" }).first()).toBeVisible();
});

test("a toast keeps its own controls reachable", async ({ page }) => {
  await boot(page);

  const toast = page.locator(TOAST, { hasText: "Mission complete" }).first();
  await expect(toast).toBeVisible({ timeout: 30_000 });

  // The other half of the contract. Clearing the toggle by making the card
  // pointer-events: none would satisfy the test above and fail here — the
  // toast would become an undismissable ghost.
  const dismiss = toast.getByRole("button", { name: /^Dismiss:/ });
  const box = await dismiss.boundingBox();
  if (!box) throw new Error("dismiss control did not lay out");
  const hit = await hitTest(page, box.x + box.width / 2, box.y + box.height / 2, "button");
  expect(hit.matched, `elementFromPoint at the dismiss centre resolved to ${hit.describe}`).toBe(
    true,
  );

  await dismiss.click();
  await expect(toast).toBeHidden();
});
