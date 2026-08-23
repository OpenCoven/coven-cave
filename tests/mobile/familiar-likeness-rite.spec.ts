import { expect, test, type Page } from "@playwright/test";

/**
 * The likeness rite at phone width.
 *
 * A trading card is exactly the kind of surface that overflows a phone, and
 * the rite it sits beside is a form the person still has to be able to reach.
 * These cases drive the real components against a mocked `/api/scry` — no
 * daemon, no runtime, and not one model call.
 */

// A 1x1 PNG. Real bytes, so the browser's own File plumbing behaves.
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const READING = {
  name: "Wren",
  office: "Archivist",
  purpose: "Keeps the archive in order",
  description: "A grey cat in a librarian's collar.",
  manner: {
    voice: "Dry and brief.",
    temperament: "Unhurried.",
    reasoning: "Works from the index outward.",
  },
  glyph: "ph:cat-fill",
  auraLabel: "Lilac",
  pronouns: "they/them",
  pronounsInferred: false,
};

async function openRiteAtTheName(page: Page) {
  // Wait for the shell to mount its listeners before asking it to navigate —
  // the mode event is fire-and-forget and a fresh page can miss it.
  await page.waitForSelector(".mobile-bottom-tabs");
  const summon = page.getByRole("button", { name: "Summon a familiar", exact: true });
  await expect(async () => {
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent("cave:navigate-mode", { detail: { mode: "agents" } }));
    });
    await expect(summon).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await page.evaluate(() => {
    // Seed the rite past the vessel question with a local Codex vessel — the
    // circle's own sessionStorage draft, which it restores on open.
    window.sessionStorage.setItem(
      "cave:summoning-draft:v1",
      JSON.stringify({
        stage: 1,
        maxVisited: 1,
        vessel: "local",
        harness: "codex",
        agentId: null,
        hermesProfileId: null,
        sshHost: "",
        sshCwd: "",
        sshCommand: "",
        name: "",
        role: "",
        description: "",
        idOverride: null,
        glyph: "ph:sparkle-fill",
        aura: null,
        model: "",
      }),
    );
  });
  await summon.click();
  await expect(page.getByRole("group", { name: "Scry a likeness (optional)" })).toBeVisible();
}

async function horizontalOverflow(page: Page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

test.describe("summon a familiar from a likeness", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("cave:onboarding:dismissed", "1");
      window.localStorage.setItem("cave:workspace:project-scope:v1", JSON.stringify("p1"));
    });
    // An empty roster is the first-run case the rite exists for: no familiar,
    // but harnesses are ready.
    await page.route("**/api/familiars**", (route) =>
      route.fulfill({ json: { ok: true, familiars: [] } }));
    await page.route("**/api/harnesses**", (route) =>
      route.fulfill({
        json: {
          ok: true,
          runtimeHost: "e2e-host",
          harnesses: [
            {
              id: "codex",
              label: "Codex",
              binary: "codex",
              chatSupported: true,
              installed: true,
              path: "/usr/local/bin/codex",
              version: "1.0.0",
              availability: { state: "ready" },
            },
          ],
        },
      }));
    await page.route("**/api/projects**", (route) =>
      route.fulfill({
        json: { ok: true, projects: [{ id: "p1", name: "Queue", root: "/repo/queue", access: "write" }] },
      }));
    await page.route("**/api/sessions/list**", (route) =>
      route.fulfill({ json: { ok: true, sessions: [] } }));
    await page.goto("/");
  });

  test("a scried likeness fills the rite as editable suggestions and raises the card", async ({ page }) => {
    let scryRequests = 0;
    await page.route("**/api/scry**", async (route) => {
      scryRequests += 1;
      const request = route.request();
      expect(request.method()).toBe("POST");
      // The harness travels as a query parameter and the likeness as the raw
      // body, so nothing about the file's own name reaches the server.
      expect(new URL(request.url()).searchParams.get("harness")).toBe("codex");
      expect(request.headers()["content-type"]).toBe("image/png");
      await route.fulfill({ json: { ok: true, harness: "codex", reading: READING } });
    });

    await openRiteAtTheName(page);

    // Before the scry there is no card — the rite shows its sigil.
    await expect(page.locator(".holo-card")).toHaveCount(0);

    await page.setInputFiles('input[type="file"][accept*="image/png"]', {
      name: "portrait.png",
      mimeType: "image/png",
      buffer: PNG_1X1,
    });

    // Every proposed value lands in the input the person is already looking at.
    await expect(page.locator("#summon-name")).toHaveValue("Wren");
    await expect(page.locator("#summon-role")).toHaveValue("Archivist");
    const described = await page.locator("#summon-description").inputValue();
    expect(described, "the purpose leads the description the familiar is created with")
      .toContain("Keeps the archive in order");
    expect(described, "the manner survives into that description").toContain("Dry and brief.");

    expect(scryRequests, "one likeness produces exactly one scry").toBe(1);

    // …and they are suggestions, not commitments.
    await page.locator("#summon-name").fill("Basil");
    await expect(page.locator("#summon-name")).toHaveValue("Basil");

    // Pronouns are flagged rather than filled in from the picture.
    const note = page.getByText(/Pronouns\s+were not inferred/i);
    await expect(note).toBeVisible();
    await expect(note).toContainText("they/them");

    // The card appears, carrying the identity the rite now holds.
    const card = page.locator(".holo-card");
    await expect(card).toBeVisible();
    await expect(card.locator(".holo-card__name")).toHaveText("Basil");
    await expect(card.locator(".holo-card__office")).toHaveText("Archivist");
    await expect(card.locator(".holo-card__portrait")).toBeVisible();
  });

  test("the card and the rite both fit a phone", async ({ page }) => {
    await page.route("**/api/scry**", (route) =>
      route.fulfill({ json: { ok: true, harness: "codex", reading: READING } }));

    await openRiteAtTheName(page);
    expect(await horizontalOverflow(page), "the rite alone must not scroll the page sideways")
      .toBeLessThanOrEqual(1);

    await page.setInputFiles('input[type="file"][accept*="image/png"]', {
      name: "portrait.png",
      mimeType: "image/png",
      buffer: PNG_1X1,
    });

    const card = page.locator(".holo-card");
    await expect(card).toBeVisible();

    expect(await horizontalOverflow(page), "the card must not push the page past the viewport")
      .toBeLessThanOrEqual(1);

    const geometry = await card.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return { left: rect.left, right: rect.right, width: rect.width, viewport: window.innerWidth };
    });
    expect(geometry.width, "the card has real size at phone width").toBeGreaterThan(80);
    expect(geometry.right, "the card's right edge stays inside the viewport")
      .toBeLessThanOrEqual(geometry.viewport + 1);
    expect(geometry.left, "the card's left edge stays inside the viewport").toBeGreaterThanOrEqual(-1);

    // The question the card illustrates has to remain reachable beside it.
    const nameField = page.locator("#summon-name");
    await expect(nameField).toBeVisible();
    const nameBox = await nameField.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return { right: rect.right, viewport: window.innerWidth };
    });
    expect(nameBox.right, "the name input is not pushed off the phone by the card")
      .toBeLessThanOrEqual(nameBox.viewport + 1);
  });

  test("a failed scry leaves the rite usable by hand", async ({ page }) => {
    await page.route("**/api/scry**", (route) =>
      route.fulfill({
        status: 503,
        json: { ok: false, error: "Coven is not available on this host, so nothing can read the likeness." },
      }));

    await openRiteAtTheName(page);
    await page.setInputFiles('input[type="file"][accept*="image/png"]', {
      name: "portrait.png",
      mimeType: "image/png",
      buffer: PNG_1X1,
    });

    // The failure reaches the person twice: as an alert they can read, and
    // through the announcer for anyone not looking at that corner of the rite.
    const failure = page
      .getByRole("alert")
      .filter({ hasText: "You can still fill the rite in by hand." });
    await expect(failure).toBeVisible();
    await expect(failure).toContainText("Coven is not available on this host");
    await expect(
      page.locator('[aria-live="assertive"]', {
        hasText: "Coven is not available on this host, so nothing can read the likeness.",
      }).first(),
    ).toHaveCount(1);
    // Nothing was proposed, and nothing was committed.
    await expect(page.locator("#summon-name")).toHaveValue("");
    await expect(page.locator(".holo-card")).toHaveCount(0);

    await page.locator("#summon-name").fill("Onyx");
    await expect(page.locator("#summon-name")).toHaveValue("Onyx");
  });
});
