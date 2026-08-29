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

\`\`\`ts
const identity = preserve(agent);
\`\`\`

\`\`\`mermaid
graph LR
  Agent --> Identity
\`\`\`

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

async function openReader(
  page: Page,
  {
    markdown = FINDINGS_MD,
    mission = COMPLETED_MISSION,
  }: {
    markdown?: string;
    mission?: typeof COMPLETED_MISSION;
  } = {},
) {
  await page.addInitScript(() => {
    window.localStorage.setItem("cave:onboarding:dismissed", "1");
    window.localStorage.setItem("cave:active-familiar", "rida");
  });
  await page.route("**/api/familiars**", (route) =>
    route.fulfill({ json: { ok: true, familiars: [{ id: FAMILIAR_ID, display_name: "Rida", role: "Researcher", status: "active", icon: "ph:sparkle-fill" }] } }),
  );
  await page.route("**/api/sessions/list**", (route) => route.fulfill({ json: { ok: true, sessions: [] } }));
  await page.route(/\/api\/roles(\?|$)/, (route) => route.fulfill({ json: { roles: [] } }));
  await page.route(/\/api\/research\/missions\?/, (route) => route.fulfill({ json: { ok: true, missions: [mission] } }));
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
          content: markdown,
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
    await expect(
      reader.getByRole("region", { name: "Evidence references · 2" }).first(),
    ).toBeVisible();
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
    const opaqueBlocks = reader.locator(".rr-codeblock");
    await expect(opaqueBlocks).toHaveCount(2);
    await expect(opaqueBlocks.nth(1).locator(".cm-mermaid-diagram")).toBeVisible();
    for (const opaqueBlock of await opaqueBlocks.all()) {
      await expect(
        opaqueBlock.locator(".research-provenance-edge"),
      ).toHaveCount(0);
      expect(
        await opaqueBlock.evaluate((element) => element.getBoundingClientRect().width),
      ).toBeCloseTo(claimWidthBeforeInspector.actual, 0);
    }

    await marginReference.focus();
    await expect(marginReference).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(reader).toHaveAttribute("data-inspector", "true");
    await expect(reader.locator(".document-reader")).not.toHaveAttribute("inert", "");
    const railHandle = reader.locator(".rr-railhandle");
    const handleBox = await railHandle.boundingBox();
    const readerBox = await reader.boundingBox();
    expect(handleBox).not.toBeNull();
    expect(readerBox).not.toBeNull();
    await page.mouse.move(
      handleBox!.x + handleBox!.width / 2,
      handleBox!.y + handleBox!.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      readerBox!.x + readerBox!.width - 260,
      handleBox!.y + handleBox!.height / 2,
    );
    await page.mouse.up();
    await expect.poll(async () => {
      const currentHandleBox = await railHandle.boundingBox();
      const currentRailBox = await reader.locator(".rr-rail").boundingBox();
      if (!currentHandleBox || !currentRailBox) return Number.POSITIVE_INFINITY;
      return Math.abs(
        currentHandleBox.x +
          currentHandleBox.width / 2 -
          currentRailBox.x,
      );
    }).toBeLessThan(2);
    const minimumHandleBox = await railHandle.boundingBox();
    expect(minimumHandleBox).not.toBeNull();
    await page.mouse.move(
      minimumHandleBox!.x + minimumHandleBox!.width / 2,
      minimumHandleBox!.y + minimumHandleBox!.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      minimumHandleBox!.x - 260,
      minimumHandleBox!.y + minimumHandleBox!.height / 2,
    );
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
    const paintedAnchor = marginReference.locator(
      ".research-provenance-edge__anchor",
    );
    const hitBox = await marginReference.boundingBox();
    const anchorBox = await paintedAnchor.boundingBox();
    expect(hitBox).not.toBeNull();
    expect(anchorBox).not.toBeNull();
    expect(hitBox!.width).toBeGreaterThan(anchorBox!.width);
    expect(hitBox!.height).toBeGreaterThan(anchorBox!.height);

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

  test("preserves prose spacing around consecutive inline references across layouts", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openReader(page, {
      markdown: `# Findings

## Result

Identity drifts independently [S1] [S14]. Evidence [S1] supports continuity.`,
    });
    const paragraph = page.locator(".rr-block-row p");
    const visibleText = () =>
      paragraph.evaluate((element) => {
        const readVisibleText = (node: Node): string => {
          if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
          if (!(node instanceof HTMLElement)) return "";
          if (getComputedStyle(node).display === "none") return "";
          return Array.from(node.childNodes, readVisibleText).join("");
        };
        return readVisibleText(element);
      });

    await expect(paragraph.locator(".rr-inline-ref")).toHaveCount(3);
    await expect(paragraph.locator(".rr-inline-ref-gap")).toHaveCount(3);
    expect(await visibleText()).toBe(
      "Identity drifts independently. Evidence supports continuity.",
    );

    await page.setViewportSize({ width: 1000, height: 800 });
    await expect(paragraph.locator(".rr-inline-ref").first()).toBeVisible();
    await expect(paragraph.locator(".rr-inline-ref-gap").first()).toBeVisible();
    expect(await visibleText()).toBe(
      "Identity drifts independently S1 S14. Evidence S1 supports continuity.",
    );
  });

  test("hides only redundant author reference columns when generated evidence is visible", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openReader(page, {
      markdown: `# Findings

## Redundant

| Finding | Source | Confidence |
| --- | --- | --- |
| First result | [S1] [S14] | High |
| Second result | [S6] | Medium |

## Mixed

| Finding | Source | Confidence |
| --- | --- | --- |
| First result | Primary source [S1] | High |
| Second result | [S6] | Medium |`,
    });
    const tables = page.locator(".rr-table");
    const redundantSourceHeader = tables
      .nth(0)
      .locator("thead th")
      .nth(1);
    const mixedSourceHeader = tables
      .nth(1)
      .locator("thead th")
      .nth(1);

    await expect(redundantSourceHeader).toHaveClass(
      /rr-table__redundant-reference/,
    );
    await expect(redundantSourceHeader).toBeHidden();
    await expect(
      tables.nth(0).locator("tbody tr").first().locator("td").nth(1),
    ).toBeHidden();
    await expect(tables.nth(0).locator(".rr-table__evidence").first()).toBeVisible();
    await expect(mixedSourceHeader).not.toHaveClass(
      /rr-table__redundant-reference/,
    );
    await expect(mixedSourceHeader).toBeVisible();

    await page.setViewportSize({ width: 1000, height: 800 });
    await expect(redundantSourceHeader).toBeVisible();
    await expect(
      tables.nth(0).locator("tbody tr").first().locator("td").nth(1),
    ).toBeVisible();
    await expect(tables.nth(0).locator(".rr-table__evidence").first()).toBeHidden();
  });

  test("committed real and missing references dismiss transient previews", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openReader(page, {
      markdown: `# Findings

## Result

Verified claim [S1]. Missing claim [S99].`,
    });
    const reader = page.locator(".research-reader");
    const tip = page.locator(".rr-tip");
    const realReference = reader.locator(
      '[data-research-reference-id="S1"][data-research-reference-representation="edge"]',
    );

    await realReference.hover();
    await expect(tip).toHaveAttribute("data-show", "true");
    await realReference.click();
    await expect(reader.locator(".research-evidence-inspector")).toBeVisible();
    await expect(tip).toHaveAttribute("data-show", "false");
    await expect(tip).toHaveCSS("opacity", "0");

    await reader
      .getByRole("button", { name: "Close evidence inspector" })
      .click();
    await page.setViewportSize({ width: 1000, height: 800 });
    const missingReference = reader.getByRole("button", {
      name: "Missing source S99",
    });
    await missingReference.hover();
    await expect(tip).toHaveAttribute("data-show", "true");
    await missingReference.click();
    await expect(tip).toHaveAttribute("data-show", "false");
    await expect(tip).toHaveCSS("opacity", "0");
    await expect(reader.locator(".research-evidence-inspector")).toBeHidden();
  });

  test("published findings keep lifecycle truth separate from an unavailable empty source ledger", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openReader(page, {
      markdown: "# Findings\n\n## Result\n\nClaim [S1].",
      mission: {
        ...COMPLETED_MISSION,
        artifacts: COMPLETED_MISSION.artifacts.map((artifact) => ({
          ...artifact,
          state: "published",
        })),
        sources: [],
      },
    });
    const reader = page.locator(".research-reader");
    const edgeReference = reader.locator(
      '[data-research-reference-id="S1"][data-research-reference-representation="edge"]',
    );
    const inlineReference = reader.locator(
      '[data-research-reference-id="S1"][data-research-reference-representation="inline"]',
    );

    await expect(reader.locator(".rr-status")).toContainText("Published");
    await expect(reader.locator(".rr-integrity")).toHaveText(
      "Sources unavailable — references can't be verified",
    );
    await expect(edgeReference).toHaveAttribute("data-tone", "unresolved");
    await expect(inlineReference).toHaveClass(/rr-sref--unresolved/);
    await expect(inlineReference).toHaveAttribute("aria-label", "Missing source S1");
    await expect(edgeReference).toBeVisible();
    await expect(inlineReference).toBeHidden();

    await edgeReference.click();
    await expect(
      page.locator(
        'div.sr-only[role="status"][aria-live="polite"][aria-atomic="true"]',
      ),
    ).toContainText("Evidence S1 has no source record.");
    await expect(reader).toHaveAttribute("data-inspector", "false");
    await expect(reader.locator(".research-evidence-inspector")).toBeHidden();
    await expect(reader.locator('[data-source-id="S1"]')).toHaveCount(0);
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

  test("focused table traps Tab and Escape returns focus to its invoker", async ({ page }) => {
    await openReader(page);
    const reader = page.locator(".research-reader");
    const focusTable = reader.getByRole("button", { name: "Focus table" });

    await focusTable.click();
    const tableDialog = page.getByRole("dialog", { name: "Key results" });
    await expect(tableDialog).toBeVisible();
    await expect(
      tableDialog.getByRole("button", { name: "Close focused table" }),
    ).toBeFocused();

    for (let step = 0; step < 8; step += 1) {
      await page.keyboard.press("Tab");
      expect(
        await tableDialog.evaluate((dialog) =>
          dialog.contains(document.activeElement),
        ),
      ).toBe(true);
    }

    await page.keyboard.press("Escape");
    await expect(tableDialog).toHaveCount(0);
    await expect(focusTable).toBeFocused();
    await expect(reader).toBeVisible();
  });

  test("wide Escape closes Contents and Evidence in most-recently-opened order", async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await openReader(page);
    const reader = page.locator(".research-reader");
    const contentsToggle = reader.getByRole("button", {
      name: /^(Show|Hide) contents$/,
    });
    const evidenceToggle = reader.getByRole("button", {
      name: /^(Show|Hide) evidence$/,
    });
    const contents = reader.locator(".rr-toc");
    const evidence = reader.locator(".research-evidence-inspector");

    await contentsToggle.click();
    await evidenceToggle.click();
    await evidence.locator('[data-source-id="S14"] .research-evidence-card__toggle').click();
    await expect(evidence.locator('[data-source-id="S14"]')).toHaveAttribute("data-open", "true");
    await page.keyboard.press("Escape");
    await expect(evidence).toBeHidden();
    await expect(contents).toBeVisible();
    await expect(evidenceToggle).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(contents).toBeHidden();
    await expect(contentsToggle).toBeFocused();

    await evidenceToggle.click();
    await contentsToggle.click();
    await contents.getByRole("button", { name: "Key results" }).click();
    await expect(reader.getByRole("heading", { name: "Key results" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(contents).toBeHidden();
    await expect(evidence).toBeVisible();
    await expect(contentsToggle).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(evidence).toBeHidden();
    await expect(evidenceToggle).toBeFocused();

    await contentsToggle.click();
    await evidenceToggle.click();
    await expect(contents).toBeVisible();
    await expect(evidence).toBeVisible();
    await page.setViewportSize({ width: 1200, height: 800 });
    await expect(contents).toBeHidden();
    await expect(evidence).toBeVisible();
    await evidence.locator('[data-source-id="S6"] .research-evidence-card__toggle').click();
    await page.keyboard.press("Escape");
    await expect(evidence).toBeHidden();
    await expect(reader).toBeVisible();
  });

  test("Evidence overlay keeps only the requested side panel accessible", async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 800 });
    await openReader(page);
    const reader = page.locator(".research-reader");
    const contentsToggle = reader.getByRole("button", {
      name: /^(Show|Hide) contents$/,
    });
    const evidenceToggle = reader.getByRole("button", {
      name: /^(Show|Hide) evidence$/,
    });
    const contents = reader.locator(".rr-toc");
    const evidence = reader.locator(".research-evidence-inspector");

    await contentsToggle.click();
    await contents.getByRole("button", { name: "Key results" }).click();
    await evidenceToggle.click();
    await expect(contents).toBeHidden();
    await expect(evidence).toBeVisible();
    await evidence.locator('[data-source-id="S14"] .research-evidence-card__toggle').click();
    await expect(evidence.locator('[data-source-id="S14"]')).toHaveAttribute("data-open", "true");
    await page.keyboard.press("Escape");
    await expect(evidence).toBeHidden();

    await evidenceToggle.click();
    await evidence.locator('[data-source-id="S6"] .research-evidence-card__toggle').click();
    await contentsToggle.click();
    await expect(evidence).toBeHidden();
    await expect(contents).toBeVisible();
    await expect(contents.locator(".document-reader__toc-link:focus")).toHaveCount(1);
    await contents.getByRole("button", { name: "Open questions" }).click();
    await page.keyboard.press("Escape");
    await expect(contents).toBeHidden();
    await expect(reader).toBeVisible();
  });

  test("Contents preserves the configured prose measure on both sides of 65rem", async ({ page }) => {
    await page.setViewportSize({ width: 1080, height: 800 });
    await openReader(page);
    const reader = page.locator(".research-reader");
    const claim = reader
      .locator(".rr-block-row", {
        hasText: "Identity has three components",
      })
      .locator(":scope > :first-child");
    const measure = () =>
      claim.evaluate((element) => {
        const probe = document.createElement("span");
        probe.style.cssText =
          "display:block;position:absolute;visibility:hidden;width:var(--document-reader-prose-measure)";
        element.parentElement!.append(probe);
        const result = {
          actual: element.getBoundingClientRect().width,
          preferred: probe.getBoundingClientRect().width,
        };
        probe.remove();
        return result;
      });

    await reader.getByRole("button", { name: "Show contents" }).click();
    const aboveBoundary = await measure();
    expect(aboveBoundary.actual).toBeGreaterThanOrEqual(
      aboveBoundary.preferred - 8,
    );
    expect(
      (
        await reader.locator(".document-reader__layout").evaluate(
          (element) => getComputedStyle(element).gridTemplateColumns,
        )
      )
        .trim()
        .split(/\s+/),
    ).toHaveLength(2);

    await page.setViewportSize({ width: 1064, height: 800 });
    await expect(reader.locator(".rr-toc")).toBeVisible();
    const belowBoundary = await measure();
    expect(belowBoundary.actual).toBeGreaterThanOrEqual(
      belowBoundary.preferred - 8,
    );
    expect(belowBoundary.actual).toBeGreaterThanOrEqual(
      aboveBoundary.actual - 8,
    );
    expect(
      (
        await reader.locator(".document-reader__layout").evaluate(
          (element) => getComputedStyle(element).gridTemplateColumns,
        )
      )
        .trim()
        .split(/\s+/),
    ).toHaveLength(1);
  });

  test("table header citations open their real source from the Evidence heading", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openReader(page, {
      markdown: FINDINGS_MD.replace(
        "| Finding | Source | Confidence |",
        "| Finding | Source S14 | Confidence |",
      ),
    });
    const reader = page.locator(".research-reader");
    const evidenceHeading = reader.locator(
      ".rr-table thead .rr-table__evidence",
    );
    await expect(evidenceHeading).toContainText("Evidence");
    const headerReference = evidenceHeading.locator(
      '[data-research-reference-id="S14"]',
    );
    await expect(headerReference).toBeVisible();
    await expect(
      reader.locator(".rr-table thead .rr-inline-ref", { hasText: "S14" }),
    ).toBeHidden();

    await headerReference.click();
    const inspector = reader.locator(".research-evidence-inspector");
    const sourceCard = inspector.locator('[data-source-id="S14"]');
    await expect(sourceCard).toHaveAttribute("data-selected", "true");
    await expect(sourceCard).toHaveAttribute("data-open", "true");
    const popupPromise = page.waitForEvent("popup");
    await sourceCard.getByRole("button", { name: "Open source" }).click();
    const popup = await popupPromise;
    await expect(popup).toHaveURL("https://example.com/s14");
    await popup.close();
  });

  test("responsive inspector close restores focus to the visible reference representation", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openReader(page);
    const reader = page.locator(".research-reader");
    const marginReference = reader
      .locator(
        '[data-research-reference-id="S14"][data-research-reference-representation="edge"]',
      )
      .first();
    await marginReference.click();
    const inspector = reader.locator(".research-evidence-inspector");
    await expect(inspector).toBeVisible();

    await page.setViewportSize({ width: 1000, height: 800 });
    await expect(marginReference).toBeHidden();
    const inlineReference = reader
      .locator(
        '[data-research-reference-id="S14"][data-research-reference-representation="inline"]',
      )
      .first();
    await expect(inlineReference).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(inspector).toBeHidden();
    await expect(inlineReference).toBeFocused();
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
    await expect(reader.locator(".rr-toc")).toBeHidden();
    await expect(documentReader).toHaveAttribute("inert", "");
    await reader
      .getByRole("button", { name: "Close evidence inspector" })
      .click();
    await expect(reader.locator(".rr-toc")).toBeHidden();
    await expect(documentScroll).not.toHaveAttribute("inert", "");

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

  test("mobile modal stacking and missing refs stay truthful at multi-digit list markers", async ({ page }) => {
    await page.setViewportSize({ width: 400, height: 720 });
    const orderedItems = Array.from(
      { length: 10 },
      (_, index) =>
        `${index + 1}. ${index === 9 ? "Missing evidence [S99]" : `Finding ${index + 1}`}`,
    ).join("\n");
    await openReader(page, {
      markdown: `# Findings\n\n## Results\n\n${orderedItems}`,
    });

    const reader = page.locator(".research-reader");
    const overlay = page.locator(".research-reader-overlay");
    const mobileTabs = page.locator(".mobile-bottom-tabs");
    await expect(mobileTabs).toBeVisible();
    const layers = await Promise.all([
      overlay.evaluate((element) => Number(getComputedStyle(element).zIndex)),
      mobileTabs.evaluate((element) => Number(getComputedStyle(element).zIndex)),
    ]);
    expect(layers[0]).toBe(350);
    expect(layers[0]).toBeGreaterThan(layers[1]);
    expect(layers[0]).toBeLessThan(400);
    await reader.getByRole("button", {
      name: "More research reader actions",
    }).click();
    const popoverPortal = page.locator(".ui-popover-portal");
    await expect(popoverPortal).toBeVisible();
    expect(
      await popoverPortal.evaluate((element) =>
        Number(getComputedStyle(element).zIndex),
      ),
    ).toBeGreaterThan(layers[0]);
    await page.keyboard.press("Escape");

    await page.evaluate(() => {
      document.documentElement.style.fontSize = "20px";
    });
    const rows = reader.locator("ol > .rr-list-row");
    await expect(rows).toHaveCount(10);
    const markerState = await rows.nth(9).evaluate((element) => {
      const marker = getComputedStyle(element, "::before");
      const firstContent = element.parentElement?.querySelector<HTMLElement>(
        ".rr-list-row > :first-child",
      );
      const currentContent = element.querySelector<HTMLElement>(
        ":scope > :first-child",
      );
      return {
        content: marker.content,
        whiteSpace: marker.whiteSpace,
        inlineSize: marker.inlineSize,
        aligned:
          Boolean(firstContent && currentContent) &&
          Math.abs(
            firstContent!.getBoundingClientRect().left -
              currentContent!.getBoundingClientRect().left,
          ) < 1,
      };
    });
    expect(markerState.content).toContain("counter(rr-ordered-item)");
    expect(markerState.whiteSpace).toBe("nowrap");
    expect(markerState.inlineSize).not.toBe("auto");
    expect(markerState.aligned).toBe(true);

    const missingEdge = reader.locator(
      '[data-research-provenance-id="S99"]',
    );
    await expect(missingEdge).toHaveCount(1);
    await expect(missingEdge).toHaveAttribute("data-tone", "unresolved");
    await expect(missingEdge).toBeHidden();
    const missingRef = reader.getByRole("button", {
      name: "Missing source S99",
    });
    await expect(missingRef).toBeVisible();
    await missingRef.click();
    await expect(
      page.locator(
        'div.sr-only[role="status"][aria-live="polite"][aria-atomic="true"]',
      ),
    ).toContainText("Evidence S99 has no source record.");
    await expect(reader.locator(".research-evidence-inspector")).toBeHidden();
    await expect(reader.locator('[data-source-id="S99"]')).toHaveCount(0);
  });
});
