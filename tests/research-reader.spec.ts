import { expect, test, type Page } from "@playwright/test";

// Research Reader — the typeset findings deliverable viewer (Research
// Reader.dc.html handoff). Reached from the Research Desk artifact rail: a
// completed mission's Findings artifact opens the reader instead of the raw
// <pre> dump.
//
// Daemon-less (COVEN_CAVE_E2E=1): every server truth is a page.route mock,
// including the artifact file route that returns the findings markdown. The
// desk is entered the same way research-desk-tabs.spec.ts reaches it.

const FAMILIAR_ID = "rida";
const NOW = Date.now();
const iso = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString();

const FINDINGS_MD = `<!-- research-provenance
mission: m-done
generated_at: 2026-07-24
-->

# Identity Preservation for Agents during Self-Evolution

> Can an agent that rewrites its own weights stay recognisably itself?

## Current understanding

Identity has **three** components and can drift independently S1 S14.

## Key results

| Finding | Source | Confidence |
| --- | --- | --- |
| Scale raises value coherence | S14 | High |
| Checkpoints cut drift ~40% | S6 | Medium |

## Open questions

- Does coherence cause drift, or co-occur? C1
- No published evidence on tool-level self-modification.
`;

const COMPLETED_MISSION = {
  version: 1,
  id: "m-done",
  familiarId: FAMILIAR_ID,
  title: "Identity Preservation for Agents during Self-Evolution",
  intent: "Whether a self-evolving agent can stay recognisably itself.",
  mode: "autoresearch",
  modeSource: "user",
  deliverable: "findings + source-ledger",
  constraints: [],
  bounds: { wallClockMinutes: 60, maxIterations: 6, sourceTarget: 18, checkpointEvery: 1, stopWhenCostUnavailable: false },
  status: "completed",
  createdAt: iso(320),
  updatedAt: iso(45),
  startedAt: iso(300),
  finishedAt: iso(45),
  iterations: [
    { number: 1, status: "completed", startedAt: iso(300), finishedAt: iso(240) },
    { number: 2, status: "completed", startedAt: iso(238), finishedAt: iso(45), summary: "Final synthesis of identity-preservation mechanisms." },
  ],
  artifacts: [
    {
      key: "findings",
      kind: "findings",
      title: "Findings",
      relativePath: "findings.md",
      iteration: 2,
      state: "working",
      updatedAt: iso(45),
    },
  ],
  sources: [
    { id: "S14", title: "Emergent value coherence at scale", url: "https://example.com/s14", publisher: "arXiv", publishedAt: "2025", sourceType: "web", status: "used", claim: "Value-coherence scores rise monotonically with parameter count.", confidence: 0.9 },
    { id: "S6", title: "Conversational identity drift in long dialogs", url: "https://example.com/s6", publisher: "arXiv", publishedAt: "2024", sourceType: "web", status: "conflicting", claim: "Persona consistency degrades past ~40 turns.", note: "Contradicts S14; logged as C1." },
    { id: "S1", title: "Survey: preservation under self-modification", url: "https://example.com/s1", publisher: "arXiv", publishedAt: "2025", sourceType: "web", status: "used", claim: "Checkpoint methods generalise; weight-anchoring does not." },
    { id: "R1", title: "Unsourced blog on AI personhood", sourceType: "web", status: "rejected", note: "Fails the evidence standard — opinion post, no primary citation.", url: "https://example.com/r1" },
    { id: "S2", title: "Persona vectors and steering", url: "https://example.com/s2", publisher: "arXiv", publishedAt: "2024", sourceType: "web", status: "used" },
    { id: "S4", title: "Utility engineering in LMs", url: "https://example.com/s4", publisher: "arXiv", publishedAt: "2025", sourceType: "web", status: "used" },
  ],
};

async function openReader(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("cave:onboarding:dismissed", "1");
    window.localStorage.setItem("cave:active-familiar", "rida");
  });
  await page.route("**/api/familiars**", (route) =>
    route.fulfill({ json: { ok: true, familiars: [{ id: FAMILIAR_ID, display_name: "Rida", role: "Researcher", status: "active", icon: "ph:sparkle-fill" }] } }),
  );
  await page.route("**/api/sessions/list**", (route) => route.fulfill({ json: { ok: true, sessions: [] } }));
  await page.route(/\/api\/roles(\?|$)/, (route) => route.fulfill({ json: { roles: [] } }));
  await page.route(/\/api\/research\/missions\?/, (route) => route.fulfill({ json: { ok: true, missions: [COMPLETED_MISSION] } }));
  await page.route("**/api/research/links", (route) => route.fulfill({ json: { ok: true, links: [] } }));
  await page.route(/\/api\/research\/generations/, (route) => route.fulfill({ json: { ok: true, generations: [] } }));
  // The artifact file route feeds the reader its findings markdown.
  await page.route("**/api/research/missions/*/files/**", (route) =>
    route.fulfill({
      json: {
        ok: true,
        file: {
          key: "findings",
          kind: "findings",
          title: "Findings",
          fileName: "findings.md",
          relativePath: "findings.md",
          content: FINDINGS_MD,
          workspacePath: "/tmp/m-done/findings.md",
          updatedAt: iso(45),
        },
      },
    }),
  );

  await page.goto("/");
  await page.locator(".shell-frame").waitFor({ timeout: 60_000 });
  await expect(async () => {
    await page.evaluate(() =>
      window.dispatchEvent(new CustomEvent("cave:navigate-mode", { detail: { mode: "surface:researcher-desk" } })),
    );
    await expect(page.locator(".research-desk")).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 90_000 });

  // The single completed mission is selected by default → its Artifacts rail
  // carries the Findings "View" button that opens the reader (lazy chunk).
  await page.getByRole("button", { name: "View Findings" }).click();
  await expect(page.locator(".research-reader")).toBeVisible({ timeout: 60_000 });
}

test.describe("research reader", () => {
  test.describe.configure({ timeout: 180_000 });

  test("typesets semantic findings and links evidence back to its supported claim", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openReader(page);
    const reader = page.locator(".research-reader");

    await expect(reader).toHaveAttribute("data-toc", "false");
    await expect(reader).toHaveAttribute("data-inspector", "false");
    await expect(reader.locator(".document-reader__title")).toHaveText("Identity Preservation for Agents during Self-Evolution");
    await expect(reader.locator(".rr-lede")).toContainText("stay recognisably itself");
    for (const heading of ["Current understanding", "Key results", "Open questions"]) {
      const semanticHeading = reader.getByRole("heading", { name: heading });
      await expect(semanticHeading).toBeVisible();
      await expect(semanticHeading.getByRole("button")).toHaveCount(0);
    }
    await expect(reader.locator(".rr-toc")).toBeHidden();
    await expect(reader.locator(".research-evidence-inspector")).toBeHidden();

    const table = reader.locator(".rr-table");
    await expect(table).toContainText("Scale raises value coherence");
    await expect(table.locator(".rr-cf--high")).toHaveText("High");
    const marginReference = reader.locator(
      ".research-provenance-edge__item",
      { hasText: "S14" },
    ).first();
    await expect(marginReference).toBeVisible();
    await expect(
      table.locator(".rr-inline-ref", { hasText: "S14" }).first(),
    ).toBeHidden();
    const measuredClaim = reader.locator(".rr-block-row", {
      hasText: "Identity has three components",
    });
    const claimWidthBeforeInspector = await measuredClaim.evaluate((element) => {
      const prose = element.firstElementChild as HTMLElement;
      const probe = document.createElement("span");
      probe.style.display = "block";
      probe.style.position = "absolute";
      probe.style.visibility = "hidden";
      probe.style.width = "var(--document-reader-prose-measure)";
      element.append(probe);
      const widths = {
        actual: prose.getBoundingClientRect().width,
        preferred: probe.getBoundingClientRect().width,
      };
      probe.remove();
      return widths;
    });
    expect(claimWidthBeforeInspector.actual).toBeCloseTo(
      claimWidthBeforeInspector.preferred,
      0,
    );

    await marginReference.click();
    await expect(reader).toHaveAttribute("data-inspector", "true");
    await expect(reader.locator(".document-reader")).not.toHaveAttribute("inert", "");
    const railHandle = reader.locator(".rr-railhandle");
    const handleBox = await railHandle.boundingBox();
    expect(handleBox).not.toBeNull();
    await page.mouse.move(
      handleBox!.x + handleBox!.width / 2,
      handleBox!.y + handleBox!.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(handleBox!.x - 260, handleBox!.y + handleBox!.height / 2);
    await page.mouse.up();
    const claimWidthAtMaxRail = await measuredClaim
      .locator(":scope > :first-child")
      .evaluate((element) => element.getBoundingClientRect().width);
    expect(claimWidthAtMaxRail).toBeCloseTo(
      claimWidthBeforeInspector.actual,
      0,
    );
    const inspector = reader.locator(".research-evidence-inspector");
    const s14card = inspector.locator('[data-source-id="S14"]');
    await expect(inspector).toBeVisible();
    await expect(s14card).toHaveAttribute("data-selected", "true");
    await expect(s14card).toHaveAttribute("data-open", "true");
    await expect(s14card.locator(".rr-sd-quote")).toContainText("rise monotonically");

    const support = s14card.locator(".rr-sd-supportlink").first();
    await support.click();
    await expect(reader).toHaveAttribute("data-inspector", "false");
    const focusedTarget = reader.locator("[data-document-target]:focus");
    await expect(focusedTarget).toHaveCount(1);
    expect(await focusedTarget.evaluate((target) => {
      const scroller = target.closest(".document-reader__scroll");
      if (!scroller) return false;
      const targetRect = target.getBoundingClientRect();
      const scrollerRect = scroller.getBoundingClientRect();
      return (
        targetRect.bottom > scrollerRect.top &&
        targetRect.top < scrollerRect.bottom
      );
    })).toBe(true);
  });

  test("opens dedicated contents and evidence panels while retaining reader actions", async ({ page }) => {
    await openReader(page);
    const reader = page.locator(".research-reader");

    await expect(reader.getByRole("button", { name: "Publish" })).toHaveAttribute(
      "title",
      "Publish",
    );
    await expect(
      reader.getByRole("button", { name: "More research reader actions" }),
    ).toHaveAttribute("title", "More research reader actions");
    await expect(reader.locator(".rr-toc")).toBeHidden();
    await reader.getByRole("button", { name: "Show contents" }).click();
    await expect(reader).toHaveAttribute("data-toc", "true");
    await expect(reader.locator(".rr-toc")).toBeVisible();
    await expect(reader.locator(".rr-toclink", { hasText: "Key results" })).toBeVisible();

    const evidenceToggle = reader.getByRole("button", { name: "Show evidence" });
    await evidenceToggle.click();
    const inspector = reader.locator(".research-evidence-inspector");
    await expect(inspector).toBeVisible();
    await inspector.getByRole("button", { name: "Close evidence inspector" }).click();
    await expect(inspector).toBeHidden();
    await expect(evidenceToggle).toBeFocused();

    await reader.getByRole("button", { name: "More research reader actions" }).click();
    await expect(page.getByRole("menuitem", { name: "Copy findings" })).toBeEnabled();
    await page.keyboard.press("Escape");

    await reader.getByRole("button", { name: "Reading preferences" }).click();
    const preferences = page.getByRole("dialog", { name: "Reading preferences" });
    await expect(preferences).toContainText("Width");
    await expect(preferences).toContainText("Line spacing");
    await expect(preferences).toContainText("Hyphenation");
    await page.keyboard.press("Escape");

    await reader.getByRole("button", { name: "Close" }).click();
    await expect(page.locator(".research-reader")).toHaveCount(0);
  });

  test("narrow overlay transfers focus, inerts covered controls, and returns focus correctly", async ({ page }) => {
    await page.setViewportSize({ width: 400, height: 720 });
    await openReader(page);
    const reader = page.locator(".research-reader");
    const documentReader = reader.locator(".document-reader");
    const documentScroll = reader.locator(".document-reader__scroll");
    const evidenceToggle = reader.getByRole("button", { name: "Show evidence" });
    const chrome = reader.locator(".rr-head");

    expect(await chrome.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await expect(reader.locator(".rr-status")).toBeVisible();
    await expect(reader.locator(".rr-integrity")).toBeVisible();
    await expect(reader.locator(".research-provenance-edge__item").first()).toBeHidden();
    await expect(reader.locator(".rr-doc")).toHaveCSS(
      "--research-evidence-edge-reserve",
      "0",
    );

    await evidenceToggle.click();
    const inspector = reader.locator(".research-evidence-inspector");
    await expect(inspector).toBeVisible();
    await expect(documentReader).toHaveAttribute("inert", "");
    await expect(inspector.getByRole("button", { name: "Close evidence inspector" })).toBeFocused();
    for (let step = 0; step < 5; step += 1) {
      await page.keyboard.press("Tab");
      expect(await documentReader.evaluate((element) =>
        element.contains(document.activeElement),
      )).toBe(false);
    }

    await page.keyboard.press("Escape");
    await expect(inspector).toBeHidden();
    await expect(documentReader).not.toHaveAttribute("inert", "");
    await expect(evidenceToggle).toBeFocused();

    const inlineReference = reader.locator(".rr-inline-ref", { hasText: "S14" }).first();
    await expect(inlineReference).toBeVisible();
    await inlineReference.click();
    await expect(documentReader).toHaveAttribute("inert", "");
    await expect(inspector).toContainText("Emergent value coherence at scale");
    await expect(
      inspector.locator('[data-source-id="S14"] .research-evidence-card__toggle'),
    ).toBeFocused();
    await inspector.getByRole("button", { name: "Close evidence inspector" }).click();
    await expect(documentReader).not.toHaveAttribute("inert", "");
    await expect(inlineReference).toBeFocused();

    await inlineReference.click();
    await inspector.locator('[data-source-id="S14"] .rr-sd-supportlink').first().click();
    await expect(documentReader).not.toHaveAttribute("inert", "");
    await expect(reader.locator("[data-document-target]:focus")).toHaveCount(1);

    await reader.getByRole("button", { name: "Show contents" }).click();
    await expect(reader).toHaveAttribute("data-toc", "true");
    await expect(reader.locator(".rr-toc")).toBeVisible();
    await expect(reader.locator(".document-reader__compact-nav")).toBeHidden();
    await expect(documentScroll).toHaveAttribute("inert", "");
    await expect(
      reader.locator('.rr-toclink[data-active="true"]'),
    ).toBeFocused();
    await expect(reader.getByRole("button", { name: "Hide contents" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await evidenceToggle.click();
    await expect(reader.locator(".research-evidence-inspector")).toBeVisible();
    await expect(documentReader).toHaveAttribute("inert", "");
    await reader
      .getByRole("button", { name: "Close evidence inspector" })
      .click();
    await expect(reader.locator(".rr-toc")).toBeVisible();
    await expect(documentScroll).toHaveAttribute("inert", "");

    const columns = await reader.locator(".document-reader__layout").evaluate(
      (element) => getComputedStyle(element).gridTemplateColumns,
    );
    expect(columns.trim().split(/\s+/)).toHaveLength(1);

    const gutters = await reader.evaluate((element) => {
      const scroll = element.querySelector<HTMLElement>(".document-reader__scroll")!;
      const prose = element.querySelector<HTMLElement>(".document-reader__column")!;
      const scrollRect = scroll.getBoundingClientRect();
      const proseRect = prose.getBoundingClientRect();
      return {
        left: proseRect.left - scrollRect.left,
        right: scrollRect.right - proseRect.right,
      };
    });
    expect(gutters.left).toBeGreaterThan(0);
    expect(gutters.right).toBeGreaterThan(0);
  });
});
