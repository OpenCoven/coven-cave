import { expect, test, type Page } from "@playwright/test";

// Research Desk five-tab surface (cave-dl74) — Prompt / Desk / Library /
// Studio / Resources inside the researcher role room (surface:researcher-desk).
//
// Daemon-less (COVEN_CAVE_E2E=1): every server truth is a page.route mock.
// The surface is reached the same way the Work Queue spec reaches its mode —
// dispatch cave:navigate-mode once the shell is hydrated, retried via toPass
// because a cold `next dev` compile can lose the event to a race. The room
// only stays open when the active familiar holds the researcher role, so the
// mocked familiar's role label is "Researcher" (familiarRoleIds tokenizes it).
//
// Mocks are stateless (no call counters): dev-mode StrictMode double-mounts
// effects, so the number of initial fetches is unpredictable. The one POST
// (Studio diagram create) records its body into a variable instead.

const FAMILIAR_ID = "rida";
const NOW = Date.now();
const iso = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString();

const BOUNDS = {
  wallClockMinutes: 60,
  maxIterations: 4,
  sourceTarget: 12,
  checkpointEvery: 1,
  stopWhenCostUnavailable: false,
};

// ── Missions: one per status the desk branches on ────────────────────────────

// Checkpoint mission FIRST: selectStableMission picks the first unarchived
// mission, so the Desk detail opens on the checkpoint state deterministically.
const CHECKPOINT_MISSION = {
  version: 1,
  id: "m-check",
  familiarId: FAMILIAR_ID,
  title: "Vector DB pricing landscape",
  intent: "Map the vector database pricing landscape and flag conflicting benchmark claims.",
  mode: "sweep",
  modeSource: "auto",
  deliverable: "report + source-ledger",
  constraints: [],
  bounds: BOUNDS,
  status: "checkpoint",
  createdAt: iso(50),
  updatedAt: iso(2),
  startedAt: iso(40),
  iterations: [
    {
      number: 1,
      status: "checkpoint",
      sessionId: "sess-check-1",
      startedAt: iso(40),
      finishedAt: iso(5),
      costUsd: 1.25,
      summary: "Pass 1 mapped the major vendors and captured their pricing pages.",
      decision: "checkpoint",
      decisionReason: "Checkpoint after every pass for review.",
      // The runner's plumbing "trigger" step is real in the data but must NOT
      // render — the stepper shows the six research phases scope→publish.
      steps: [
        { id: "trigger", type: "phase", status: "succeeded" },
        { id: "scope", type: "phase", status: "succeeded" },
        { id: "gather", type: "phase", status: "succeeded" },
        { id: "challenge", type: "phase", status: "succeeded" },
        { id: "synthesize", type: "phase", status: "succeeded" },
        { id: "control", type: "phase", status: "succeeded" },
        { id: "publish", type: "phase", status: "succeeded" },
      ],
    },
  ],
  artifacts: [
    {
      key: "draft-1",
      kind: "findings",
      title: "Working synthesis",
      relativePath: "artifacts/draft.md",
      iteration: 1,
      state: "working",
      updatedAt: iso(5),
    },
  ],
  sources: [
    {
      id: "s-used-1",
      title: "Qdrant pricing docs",
      url: "https://qdrant.tech/pricing",
      sourceType: "web",
      status: "used",
    },
    {
      id: "s-conflict-1",
      title: "Vendor benchmarks blog",
      url: "https://example.com/benchmarks",
      sourceType: "web",
      status: "conflicting",
      claim: "Claims 10x faster ingest than every rival.",
    },
  ],
};

const RUNNING_MISSION = {
  version: 1,
  id: "m-run",
  familiarId: FAMILIAR_ID,
  title: "Agent memory survey",
  intent: "Survey approaches to long-term agent memory across open-source frameworks.",
  mode: "sweep",
  modeSource: "auto",
  deliverable: "report + source-ledger",
  constraints: [],
  bounds: BOUNDS,
  status: "running",
  createdAt: iso(12),
  updatedAt: iso(0),
  startedAt: iso(10),
  iterations: [
    {
      number: 1,
      status: "running",
      sessionId: "sess-run-1",
      startedAt: iso(10),
      steps: [
        { id: "scope", type: "phase", status: "succeeded" },
        { id: "gather", type: "phase", status: "running", detail: "Searching sources…" },
      ],
    },
  ],
  artifacts: [
    {
      key: "log-1",
      kind: "research-log",
      title: "Survey research log",
      relativePath: "artifacts/log.md",
      iteration: 1,
      state: "working",
      updatedAt: iso(1),
    },
  ],
  sources: [
    {
      id: "s-run-1",
      title: "LangGraph memory docs",
      url: "https://example.com/langgraph-memory",
      sourceType: "web",
      status: "used",
    },
  ],
};

const FAILED_MISSION = {
  version: 1,
  id: "m-fail",
  familiarId: FAMILIAR_ID,
  title: "Rust GUI toolkit scan",
  intent: "Scan the Rust GUI toolkit space for production readiness.",
  mode: "brief",
  modeSource: "auto",
  deliverable: "brief",
  constraints: [],
  bounds: BOUNDS,
  status: "failed",
  createdAt: iso(130),
  updatedAt: iso(115),
  startedAt: iso(125),
  finishedAt: iso(115),
  lastError: "The research session crashed before publishing.",
  iterations: [
    { number: 1, status: "failed", sessionId: "sess-fail-1", startedAt: iso(125), finishedAt: iso(115) },
  ],
  artifacts: [],
  sources: [],
};

const COMPLETED_MISSION = {
  version: 1,
  id: "m-done",
  familiarId: FAMILIAR_ID,
  title: "Embedded analytics benchmark",
  intent: "Benchmark embedded analytics options for a Rust desktop app.",
  mode: "paper",
  modeSource: "user",
  deliverable: "paper + source-ledger",
  constraints: [],
  bounds: BOUNDS,
  status: "completed",
  createdAt: iso(320),
  updatedAt: iso(200),
  startedAt: iso(300),
  finishedAt: iso(200),
  iterations: [
    { number: 1, status: "completed", startedAt: iso(300), finishedAt: iso(240), costUsd: 2.1 },
    {
      number: 2,
      status: "completed",
      startedAt: iso(238),
      finishedAt: iso(200),
      costUsd: 1.4,
      summary: "Final synthesis of the embedded analytics options and tradeoffs.",
    },
  ],
  artifacts: [
    {
      key: "report-1",
      kind: "report",
      title: "Embedded analytics findings",
      relativePath: "artifacts/report.md",
      knowledgeId: "kn-embed-1",
      iteration: 2,
      state: "published",
      updatedAt: iso(200),
    },
  ],
  sources: [
    {
      id: "s-done-1",
      title: "DuckDB embedded guide",
      url: "https://example.com/duckdb-embedded",
      sourceType: "web",
      status: "used",
    },
  ],
};

const MISSIONS = [CHECKPOINT_MISSION, RUNNING_MISSION, FAILED_MISSION, COMPLETED_MISSION];

// ── Saved links (Resources / Prompt quick saves) ─────────────────────────────

const LINKS = [
  { id: "l-gh", url: "https://github.com/acme/vector-bench", category: "github", title: "acme/vector-bench", addedAt: iso(60), source: "chat" },
  { id: "l-docs", url: "https://docs.qdrant.tech/guide", category: "docs", title: "Qdrant guide", addedAt: iso(120), source: "chat" },
  { id: "l-paper", url: "https://arxiv.org/abs/2401.01234", category: "paper", title: "Efficient ANN search", addedAt: iso(90), source: "desk" },
];

// ── Studio generation (mock POST → ready diagram record) ─────────────────────

const DIAGRAM_GENERATION = {
  version: 1,
  id: "gen-diagram-1",
  familiarId: FAMILIAR_ID,
  kind: "diagram",
  sourceMissionId: COMPLETED_MISSION.id,
  sourceTitle: COMPLETED_MISSION.title,
  sourceArtifactKey: "report-1",
  status: "ready",
  createdAt: iso(0),
  updatedAt: iso(0),
  content: { kind: "diagram", mermaid: "graph TD;\n  A[Scope] --> B[Gather];" },
};

// ── Boot ─────────────────────────────────────────────────────────────────────

type BootHandles = { createdGenerationBodies: unknown[] };

async function mockResearchApis(page: Page): Promise<BootHandles> {
  const handles: BootHandles = { createdGenerationBodies: [] };
  await page.addInitScript(() => {
    window.localStorage.setItem("cave:onboarding:dismissed", "1");
    window.localStorage.setItem("cave:active-familiar", "rida");
  });
  await page.route("**/api/familiars**", (route) =>
    route.fulfill({
      json: {
        ok: true,
        familiars: [
          // Role label "Researcher" grants the researcher role token, which is
          // what makes surface:researcher-desk visible for this familiar.
          { id: FAMILIAR_ID, display_name: "Rida", role: "Researcher", status: "active", icon: "ph:sparkle-fill" },
        ],
      },
    }),
  );
  await page.route("**/api/sessions/list**", (route) => route.fulfill({ json: { ok: true, sessions: [] } }));
  // No active role manifests — the role label alone opens the room.
  await page.route(/\/api\/roles(\?|$)/, (route) => route.fulfill({ json: { roles: [] } }));
  await page.route(/\/api\/research\/missions\?/, (route) =>
    route.fulfill({ json: { ok: true, missions: MISSIONS } }),
  );
  await page.route("**/api/research/links", (route) =>
    route.fulfill({ json: { ok: true, links: LINKS } }),
  );
  await page.route(/\/api\/research\/generations/, async (route) => {
    if (route.request().method() === "POST") {
      handles.createdGenerationBodies.push(route.request().postDataJSON());
      await route.fulfill({ json: { ok: true, generation: DIAGRAM_GENERATION } });
      return;
    }
    await route.fulfill({ json: { ok: true, generations: [] } });
  });
  return handles;
}

/** Dispatch the mode switch once the shell is hydrated; re-fire until the
 *  surface mounts so a slow cold compile can't lose the event to a race.
 *  The room component is code-split (next/dynamic), so the first entry also
 *  waits on the dev server compiling its chunk — observed ~15s cold, worse
 *  with several workers booting in parallel; hence the generous budget. */
async function enterResearchDesk(page: Page) {
  await page.getByRole("navigation").first().waitFor({ timeout: 60_000 });
  await expect(async () => {
    await page.evaluate(() =>
      window.dispatchEvent(new CustomEvent("cave:navigate-mode", { detail: { mode: "surface:researcher-desk" } })),
    );
    await expect(page.locator(".research-desk")).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 90_000 });
}

async function openResearchDesk(page: Page): Promise<BootHandles> {
  const handles = await mockResearchApis(page);
  await page.goto("/");
  await enterResearchDesk(page);
  return handles;
}

function deskTab(page: Page, name: string | RegExp) {
  return page
    .getByRole("tablist", { name: "Research desk views" })
    .getByRole("tab", { name });
}

// ─────────────────────────────────────────────────────────────────────────────

test.describe("research desk tabs", () => {
  // Boot cost dominates: page load + role-surface chunk compile on a cold
  // `next dev` under parallel workers. The default 60s test budget reads
  // slow-compile as failure; triple it (same pattern as other cold-boot specs).
  test.describe.configure({ timeout: 180_000 });

  test("tab strip has five tabs and the Desk shows runs rail, stepper, and checkpoint actions", async ({ page }) => {
    await openResearchDesk(page);
    const desk = page.locator(".research-desk");

    // Five tabs with real tablist semantics; missions exist, so the surface
    // lands on the Desk by default.
    const tablist = page.getByRole("tablist", { name: "Research desk views" });
    await expect(tablist.getByRole("tab")).toHaveCount(5);
    for (const name of ["Prompt", "Desk", "Library", "Studio", "Resources"]) {
      await expect(tablist.getByRole("tab", { name: new RegExp(`^${name}`) })).toBeVisible();
    }
    await expect(deskTab(page, /^Desk/)).toHaveAttribute("aria-selected", "true");

    // Runs rail lists every mission with its status.
    const rail = desk.getByRole("navigation", { name: "Research missions" });
    for (const mission of MISSIONS) {
      await expect(rail.getByRole("button", { name: new RegExp(mission.title) })).toBeVisible();
    }
    // The checkpoint attention line derives from the full mission set.
    await expect(rail.getByText(/1 checkpoint waiting/)).toBeVisible();

    // 6-phase stepper: Scope first, six phases, and the runner's plumbing
    // "trigger" step (present in the mock data) never renders a label.
    const steps = desk.locator(".research-desk-stepper__track .research-desk-step");
    await expect(steps).toHaveCount(6);
    await expect(steps.first()).toContainText("Scope");
    await expect(steps.last()).toContainText("Publish");
    await expect(desk.locator(".research-desk-stepper__track")).not.toContainText("Trigger");

    // Checkpoint mission is selected (first unarchived) → checkpoint action
    // bar: Continue (i2/4) + Finish now on the left, Cancel/Archive on the right.
    await expect(desk.locator("#research-mission-title")).toHaveText(CHECKPOINT_MISSION.title);
    const actions = desk.locator(".research-mission-actions");
    // Continue's accessible name is its full-consequence aria-label, so match
    // the visible i2/4 text instead of the role name.
    const continueButton = actions.locator("button", { hasText: "Continue (i2/4)" });
    await expect(continueButton).toBeVisible();
    await expect(continueButton).toHaveAttribute("aria-label", /start iteration 2 of 4/);
    await expect(actions.getByRole("button", { name: "Finish now" })).toBeVisible();
    await expect(actions.getByRole("button", { name: "Cancel run" })).toBeVisible();
    await expect(actions.getByRole("button", { name: "Archive" })).toBeVisible();
    await expect(desk.getByText("Refine direction before continuing")).toBeVisible();

    // The evidence-delta rail triages the conflicting source.
    const delta = desk.getByRole("region", { name: "Evidence delta" });
    await expect(delta.getByText("Vendor benchmarks blog")).toBeVisible();
    await expect(delta.getByRole("button", { name: "Verify next pass" })).toBeVisible();

    // Selecting the failed run surfaces its lastError and a Retry action.
    await rail.getByRole("button", { name: /Rust GUI toolkit scan/ }).click();
    await expect(desk.locator(".research-mission-stop")).toContainText(
      "The research session crashed before publishing.",
    );
    await expect(desk.locator(".research-mission-actions").getByRole("button", { name: /^Retry/ })).toBeVisible();
  });

  test("Library shows the live ticker and artifact cards; the chosen tab survives a reload", async ({ page }) => {
    await openResearchDesk(page);
    await deskTab(page, /^Library/).click();

    const library = page.locator(".research-library");
    await expect(library).toBeVisible();

    // Live ticker from the running mission (real phase + pass, never invented).
    const ticker = library.locator(".research-library__ticker");
    await expect(ticker).toContainText("Running now:");
    await expect(ticker).toContainText("Agent memory survey");
    await expect(ticker).toContainText("Gather");
    await expect(ticker.getByRole("button", { name: "Watch →" })).toBeVisible();

    // One artifact per mission that has one: checkpoint draft + running log +
    // completed report.
    await expect(library.getByText("3 artifacts from 3 runs")).toBeVisible();
    const publishedCard = library.locator(".research-library-card", {
      hasText: "Embedded analytics findings",
    });
    await expect(publishedCard).toBeVisible();
    // Published artifact with a knowledgeId gets the real Grimoire open path.
    await expect(
      publishedCard.getByRole("button", { name: "Open Embedded analytics findings in the Grimoire" }),
    ).toBeVisible();
    // The running mission's working draft reads as in-progress.
    await expect(
      library.locator(".research-library-card", { hasText: "Survey research log" }),
    ).toContainText("run live");

    // Tab persistence: reload keeps the Library selection (cave:research:tab).
    await page.reload();
    await enterResearchDesk(page);
    await expect(deskTab(page, /^Library/)).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(".research-library")).toBeVisible();
  });

  test("Studio renders 5 creatable + 3 disabled media cards and drafts a diagram from the completed run", async ({ page }) => {
    const handles = await openResearchDesk(page);
    await deskTab(page, /^Studio/).click();

    const studio = page.locator(".research-studio");
    await expect(studio).toBeVisible();

    // Five real generation kinds render as enabled buttons (sources exist)…
    const creatable = studio.locator("button.research-studio-card");
    await expect(creatable).toHaveCount(5);
    for (const label of ["Diagram", "Blog / article", "Slides", "Infographic", "Social thread"]) {
      await expect(creatable.filter({ hasText: label }).first()).toBeEnabled();
    }
    // …and the three media kinds are honest non-buttons with aria-disabled.
    const media = studio.locator(".research-studio-card--media[aria-disabled='true']");
    await expect(media).toHaveCount(3);
    for (const label of ["Podcast", "Short video", "Long video"]) {
      await expect(media.filter({ hasText: label })).toContainText("not available yet");
    }

    // Create a diagram from the completed mission.
    await studio.locator('button.research-studio-card[data-kind="diagram"]').click();
    const dialog = page.getByRole("dialog", { name: "Generate Diagram" });
    await expect(dialog).toBeVisible();
    const doneChip = dialog.getByRole("button", { name: COMPLETED_MISSION.title });
    await doneChip.click();
    await expect(doneChip).toHaveAttribute("aria-pressed", "true");
    await dialog.getByRole("button", { name: "✦ Generate Diagram" }).click();

    // The POST carried the selected mission (directions empty → omitted).
    await expect
      .poll(() => handles.createdGenerationBodies.at(-1))
      .toEqual({ familiarId: FAMILIAR_ID, kind: "diagram", sourceMissionId: COMPLETED_MISSION.id });

    // The ready record renders as a row; its Mermaid is viewable verbatim.
    await expect(dialog).toHaveCount(0);
    const row = studio.locator(".research-studio-row", { hasText: "Diagram — Embedded analytics benchmark" });
    await expect(row).toBeVisible();
    await expect(row).toContainText("ready · mermaid");
    await row.getByRole("button", { name: "⌗ View Mermaid" }).click();
    await expect(row.locator(".research-studio__code")).toContainText("graph TD;");
  });

  test("Resources groups links by category and the detail overlay opens and closes with focus handling", async ({ page }) => {
    await openResearchDesk(page);
    await deskTab(page, /^Resources/).click();

    const res = page.locator(".research-res");
    await expect(res).toBeVisible();
    await expect(res.getByText("3 saved", { exact: false })).toBeVisible();

    // Category groups in shelf order, each with its own links.
    const github = res.getByRole("region", { name: "GitHub resources" });
    await expect(github).toBeVisible();
    await expect(github.getByRole("button", { name: /acme\/vector-bench/ })).toBeVisible();
    await expect(res.getByRole("region", { name: "Docs resources" })).toContainText("Qdrant guide");
    await expect(res.getByRole("region", { name: "Papers resources" })).toContainText("Efficient ANN search");

    // Detail overlay: opens focus-trapped, closes back to the trigger.
    const opener = github.getByRole("button", { name: /acme\/vector-bench — open details/ });
    await opener.click();
    const overlay = page.getByRole("dialog", { name: "acme/vector-bench" });
    await expect(overlay).toBeVisible();
    // Focus moved into the dialog (focus trap active).
    await expect
      .poll(() => page.evaluate(() => {
        const dialog = document.querySelector('.research-res-overlay__dialog');
        return Boolean(dialog && dialog.contains(document.activeElement));
      }))
      .toBe(true);
    await expect(overlay.locator(".research-res-overlay__sub")).toHaveText("github.com");
    await overlay.getByRole("button", { name: "Close resource details" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    // Focus returns to the card title that opened it.
    await expect(opener).toBeFocused();
  });

  test("Prompt shows the composer, opens the slash palette on '/', and mode cards track typed intent", async ({ page }) => {
    await openResearchDesk(page);
    await deskTab(page, /^Prompt/).click();

    const intake = page.locator(".research-intake");
    await expect(intake.getByRole("heading", { name: "Turn a question into durable knowledge." })).toBeVisible();

    const intent = page.locator("#research-intent");
    await expect(intent).toBeVisible();

    // "/" at the end of the draft opens the command palette.
    await intent.click();
    await intent.pressSequentially("/");
    const palette = page.getByRole("listbox", { name: "Prompt commands" });
    await expect(palette).toBeVisible();
    for (const cmd of ["/brief", "/sweep", "/paper", "/deep", "/improve"]) {
      await expect(palette.getByRole("option", { name: new RegExp(`^${cmd} `) })).toBeVisible();
    }
    await intent.press("Escape");
    await expect(palette).toHaveCount(0);

    // Auto mode routing reacts to the typed intent: "whitepaper" → Paper.
    await intent.fill("Write a whitepaper on vector databases for our team");
    const selectedCard = intake.locator('.research-mode-card[data-selected="true"]');
    await expect(selectedCard).toContainText("Paper");
    await expect(selectedCard).toContainText("auto pick");
    await expect(intake.getByText(/Auto picks one from your prompt — Paper for now/)).toBeVisible();

    // Clicking a card is a manual override, said in plain words.
    await intake.locator(".research-mode-card", { hasText: "Deep loop" }).click();
    await expect(intake.getByText("You chose Deep loop — this run will use it.")).toBeVisible();

    // Quick saves panel lists the shared saved-links store.
    const saves = intake.getByRole("region", { name: "Quick saves" });
    await expect(saves.getByRole("button", { name: /acme\/vector-bench/ })).toBeVisible();
    await expect(saves.getByRole("button", { name: /Qdrant guide/ })).toBeVisible();
  });
});
