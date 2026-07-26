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
  await page.getByRole("navigation").first().waitFor({ timeout: 60_000 });
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

  test("typesets findings, chips the sources, and cross-links the evidence rail", async ({ page }) => {
    await openReader(page);
    const reader = page.locator(".research-reader");

    // Title, lede, and the collapsible sections all typeset from the markdown.
    await expect(reader.locator(".rr-doc h1")).toHaveText("Identity Preservation for Agents during Self-Evolution");
    await expect(reader.locator(".rr-lede")).toContainText("stay recognisably itself");
    for (const heading of ["Current understanding", "Key results", "Open questions"]) {
      await expect(reader.locator(".rr-h2-btn", { hasText: heading })).toBeVisible();
    }

    // Key Results markdown table renders with a confidence chip and a source chip.
    const table = reader.locator(".rr-table");
    await expect(table).toContainText("Scale raises value coherence");
    await expect(table.locator(".rr-cf--high")).toHaveText("High");
    await expect(table.locator(".rr-sref", { hasText: "S14" }).first()).toBeVisible();

    // Evidence rail is built from the real ledger sources.
    const rail = reader.locator(".rr-rail");
    await expect(rail).toContainText("Evidence · 4 used");
    await expect(rail.locator(".rr-src", { hasText: "Emergent value coherence at scale" })).toBeVisible();

    // Collapsing a section hides its body.
    const openQ = reader.locator(".rr-h2-btn", { hasText: "Open questions" });
    await openQ.click();
    await expect(openQ).toHaveAttribute("aria-expanded", "false");

    // Clicking a prose S14 chip opens its evidence card, revealing the quote.
    await reader.locator(".rr-doc .rr-sref", { hasText: "S14" }).first().click();
    const s14card = rail.locator(".rr-src", { hasText: "Emergent value coherence at scale" });
    await expect(s14card).toHaveAttribute("data-open", "true");
    await expect(s14card.locator(".rr-sd-quote")).toContainText("rise monotonically");
    // The card's Supports links are derived from the sections that cite S14.
    await expect(s14card.locator(".rr-sd-supportlink", { hasText: "Key results" })).toBeVisible();
  });

  test("expands to reveal the contents rail and copies the findings", async ({ page }) => {
    await openReader(page);
    const reader = page.locator(".research-reader");

    // Contents rail is hidden until expanded.
    await expect(reader.locator(".rr-toc")).toBeHidden();
    await reader.getByRole("button", { name: "Expand" }).click();
    await expect(reader).toHaveAttribute("data-expanded", "true");
    await expect(reader.locator(".rr-toc")).toBeVisible();
    await expect(reader.locator(".rr-toclink", { hasText: "Key results" })).toBeVisible();

    // Copy is offered for a written deliverable (clipboard success itself is
    // environment-dependent under headless, so assert the affordance, not the
    // confirmation).
    await expect(reader.getByRole("button", { name: "Copy findings as markdown" })).toBeEnabled();

    // Close dismisses the reader.
    await reader.getByRole("button", { name: "Close" }).click();
    await expect(page.locator(".research-reader")).toHaveCount(0);
  });
});
