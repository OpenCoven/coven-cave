import { expect, test, type Page } from "@playwright/test";

// The Expand reader (Reader.dc.html frame 3a), asserted by RENDERING it.
//
// Why this spec exists: two visibly broken things shipped in the reader —
// footnote markers left raw in the prose with the definition block dumped
// underneath (#4264), and citations degraded to bare links instead of chips
// (#4265). Both survived 18 source pins, four design gates, nine CI checks and
// a bot review, because none of those render anything. Both were found by
// opening the app and looking at it.
//
// So every assertion below is deliberately something a source-text pin CANNOT
// check: what the DOM actually contains once the markdown pipeline, the lazy
// chunk and the citation wiring have all run.
//
// Daemon-less: the reader reads its provenance from the turn it is handed, so
// mocking /api/chat/conversation is enough to drive every surface here.

// Serial, with headroom: every test here opens a chat surface and then a
// lazily-chunked modal. Run fully parallel they stampede a cold `next dev`
// compiler with the same route at once and all time out on the FIRST
// navigation — which reads as "the reader is broken" when it is only cold.
// Serial lets the first test pay the compile and the rest run warm. Same
// posture as canonical-memory / code-surface / research-desk-tabs.
test.describe.configure({ mode: "serial", timeout: 180_000 });

const ISO = "2026-08-03T14:02:00.000Z";

/** The prompt the reader echoes back above the answer. */
const USER_PROMPT = "Review PR #4188 for correctness and regressions.";

/** An answer with headings (rail), footnote citations (chips + Sources) and
 *  enough prose that the document scrolls. */
const CITED_ANSWER = `Reviewing PR #4188 for correctness and regressions.

## Findings

### 1. Composer follow-up grid loses responsiveness

The base rule's \`grid-auto-flow: column\` auto-sizes columns to however many suggestion buttons actually render[^mdn] — one, two, three or four items each stretch to fill the row. This PR hardcodes three tracks, so a reply that surfaces fewer renders left-aligned with dead space instead of stretching.

The same rule is duplicated inside the \`@media (max-width: 40rem)\` block, so the regression reaches mobile as well as desktop. Neither copy is covered by a rendering test — the existing spec regex-matches the stylesheet source, which passes whether or not the layout is correct.

Worse, the two declarations can drift apart silently: nothing asserts they stay in agreement, so a later edit to one is invisible until someone opens the composer at a width that exercises the other.

### 2. Touch-target min-height leaves the label top-aligned

The rule sets \`min-height: 44px\` to satisfy the enhanced target-size criterion[^wcag] without a matching \`align-items: center\`, so a one-line label sits at the top of a 44px box.

The same rule is duplicated inside the \`@media (max-width: 40rem)\` block, so the regression reaches mobile as well as desktop. Neither copy is covered by a rendering test — the existing spec regex-matches the stylesheet source, which passes whether or not the layout is correct.

Worse, the two declarations can drift apart silently: nothing asserts they stay in agreement, so a later edit to one is invisible until someone opens the composer at a width that exercises the other.

On a touch device the gap is easy to miss because the tap target is still 44px — only the label's position is wrong, so the control works while looking unfinished.

## Verdict

Request changes. Revert both declarations and add a render test at one, two and three suggestions.

[^mdn]: [grid-auto-flow — CSS | MDN](https://developer.mozilla.org/docs/Web/CSS/grid-auto-flow) — Controls how the auto-placement algorithm works.
[^wcag]: [Understanding SC 2.5.5: Target Size (Enhanced)](https://www.w3.org/WAI/WCAG21/Understanding/target-size-enhanced) — Targets are at least 44 by 44 CSS pixels.
`;

/** No headings, no citations, no tools — the turn that must produce no rail
 *  and no provenance footer at all. */
const BARE_ANSWER = "Reverted both declarations and pushed the fix.";

/** Two batches (the textOffset moves once), one skill, one MCP server, and one
 *  failure — enough for every footer tab to have something behind it. */
const TOOLS = [
  { id: "t1", name: "Skill", input: '{"skill":"code-review"}', status: "ok", durationMs: 900, textOffset: 0 },
  { id: "t2", name: "Read", input: "src/styles/cave-chat/transcript.css", status: "ok", durationMs: 5200, textOffset: 0 },
  { id: "t3", name: "Grep", input: "align-items in transcript.css", status: "error", durationMs: 41000, textOffset: 220 },
  { id: "t4", name: "mcp__github__get_pull_request", input: "OpenCoven/coven-cave#4188", status: "ok", durationMs: 2100, textOffset: 220 },
];

const SESSION = {
  id: "s-reader",
  title: "Review PR #4188",
  status: "idle",
  origin: "chat",
  project_root: "/Users/dev/Documents/GitHub/OpenCoven/coven-cave",
  harness: "claude",
  familiarId: "nova",
  model: "sonnet-4.6",
  runtime: "local",
  exit_code: 0,
  archived_at: null,
  created_at: ISO,
  updated_at: ISO,
};

type TurnSpec = { text: string; tools?: unknown[] };

async function openReader(page: Page, turn: TurnSpec) {
  await page.addInitScript(() => {
    window.localStorage.setItem("cave:onboarding:dismissed", "1");
    window.localStorage.setItem("cave:active-familiar", "nova");
    window.localStorage.setItem("cave:familiar:nova:last-surface", "chat");
    // Keep the nav expanded so the transcript keeps its full width.
    window.localStorage.setItem("cave:shell:min-applied:cave.shell.widths.v3", "1");
    window.localStorage.setItem("cave:shell:min-applied:cave.shell.widths.v3.two-pane", "1");
  });
  await page.route("**/api/familiars**", (route) =>
    route.fulfill({
      json: { ok: true, familiars: [{ id: "nova", display_name: "Nova", role: "Orchestrator", status: "active", icon: "ph:sparkle-fill" }] },
    }),
  );
  await page.route("**/api/sessions/list**", (route) =>
    route.fulfill({ json: { ok: true, sessions: [SESSION] } }),
  );
  await page.route("**/api/chat/conversation/**", (route) =>
    route.fulfill({
      json: {
        ok: true,
        conversation: {
          turns: [
            { id: "u1", role: "user", text: USER_PROMPT, createdAt: ISO },
            { id: "a1", role: "assistant", text: turn.text, createdAt: ISO, durationMs: 134_000, tools: turn.tools ?? [] },
          ],
        },
        context: {},
      },
    }),
  );

  await page.goto("/?mode=chat");
  await page.waitForSelector(".chat-surface", { timeout: 30_000 });
  await page.getByText("Review PR #4188").first().click();

  // Wait for the ANSWER, not a fixed delay: a cold route renders its empty
  // state first, which a timed probe reads as "the feature is broken".
  const marker = turn.text.slice(0, 40);
  await expect(page.locator(".cave-artifact-content").last()).toContainText(marker.slice(0, 24), { timeout: 30_000 });

  await page.locator(".cave-artifact-content").last().hover();
  await page.locator('button[aria-label="Expand message"]').last().click({ force: true });
  // The reader is loaded through next/dynamic so its chunk (and stylesheet)
  // stay off the / route's first paint (#4255) — the FIRST open in a run pays
  // for `next dev` to compile that chunk on demand, which measured well past
  // 30s on a cold server. Generous here on purpose: the alternative is a spec
  // that passes only on Playwright's retry, and a test that needs a retry to
  // go green is a test that will eventually go red for no reason.
  await expect(page.locator(".cave-reader")).toBeVisible({ timeout: 90_000 });
}

test("cited sources render as chips, with no footnote plumbing left in the prose", async ({ page }) => {
  await openReader(page, { text: CITED_ANSWER, tools: TOOLS });
  const body = page.locator(".cave-reader-doc .cave-md");

  // #4265: the reader rendered through MarkdownBlock, which does not mount the
  // citation previews, so these were plain underlined links.
  await expect(body.locator("a.cave-citation-chip")).toHaveCount(2);
  await expect(body.locator("a.cave-citation-chip").first()).toHaveText("developer.mozilla.org");

  // #4264: the reader was handed raw `text`, so the markers survived into the
  // prose and the definition block was dumped at the end of the document.
  await expect(body).not.toContainText("[^mdn]");
  await expect(body).not.toContainText("[^wcag]");
  await expect(body).not.toContainText("Controls how the auto-placement algorithm works");
});

test("the contents rail is built from the answer's own headings and scrolls to them", async ({ page }) => {
  await openReader(page, { text: CITED_ANSWER, tools: TOOLS });

  const rail = page.locator(".cave-reader-rail__link");
  await expect(rail).toHaveText([
    "Findings",
    "1. Composer follow-up grid loses responsiveness",
    "2. Touch-target min-height leaves the label top-aligned",
    "Verdict",
  ]);

  const doc = page.locator(".cave-reader-doc");
  // Guard the premise: if the document fits, "clicking scrolls" is vacuous.
  expect(await doc.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  expect(await doc.evaluate((el) => el.scrollTop)).toBe(0);

  await rail.last().click();
  await expect
    .poll(async () => doc.evaluate((el) => el.scrollTop), { timeout: 10_000 })
    .toBeGreaterThan(0);
  // And it went to the right place: the Verdict heading is now in the viewport.
  await expect(page.locator(".cave-reader-doc h2", { hasText: "Verdict" })).toBeInViewport();
});

test("the provenance footer states the turn's own counts", async ({ page }) => {
  await openReader(page, { text: CITED_ANSWER, tools: TOOLS });

  const receipt = page.locator(".cave-reader-foot__summary");
  await expect(receipt).toContainText("2 sources");
  await expect(receipt).toContainText("4 steps");
  await expect(receipt).toContainText("2 batches");
  await expect(receipt).toContainText("1 error");

  await page.locator(".cave-reader-foot__toggle").click();
  const panel = page.locator(".cave-reader-panel");
  await expect(panel).toBeVisible();
  await expect(panel.locator(".cave-reader-tab")).toHaveText([
    "Sources · 2",
    "Tools · 4",
    "Skills · 2",
  ]);
  await expect(panel.locator(".cave-reader-row--source")).toHaveCount(2);
});

test("a turn with no headings and no provenance renders neither rail nor footer", async ({ page }) => {
  // An empty rail or an empty "How this was made" claims more than their
  // absence does — a turn that stood on nothing must say nothing.
  await openReader(page, { text: BARE_ANSWER });

  await expect(page.locator(".cave-reader-rail")).toHaveCount(0);
  await expect(page.locator(".cave-reader-foot")).toHaveCount(0);
  await expect(page.locator(".cave-reader-doc")).toContainText("Reverted both declarations");
});

test("Escape unwinds one layer at a time: source viewer, then menu, then reader", async ({ page }) => {
  await openReader(page, { text: CITED_ANSWER, tools: TOOLS });

  // Menu first — closing it must not also close the reader underneath.
  await page.locator('button[aria-label="Export answer"]').click();
  await expect(page.locator(".cave-reader-menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".cave-reader-menu")).toHaveCount(0);
  await expect(page.locator(".cave-reader")).toBeVisible();

  // Then a source viewer opened from the footer.
  await page.locator(".cave-reader-foot__toggle").click();
  await page.locator(".cave-reader-row--source").first().click();
  await expect(page.locator(".cave-reader-viewer")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".cave-reader-viewer")).toHaveCount(0);
  await expect(page.locator(".cave-reader")).toBeVisible();

  // Only now does Escape close the reader itself.
  await page.keyboard.press("Escape");
  await expect(page.locator(".cave-reader")).toHaveCount(0);
});

test("the reader echoes the prompt that produced the answer", async ({ page }) => {
  await openReader(page, { text: CITED_ANSWER, tools: TOOLS });

  const ask = page.locator(".cave-reader-ask");
  await expect(ask).toBeVisible();
  await expect(ask).toContainText("You asked");
  await expect(ask.locator(".cave-reader-ask__text")).toHaveText(USER_PROMPT);

  // The card sits ABOVE the answer — it frames what follows, it is not a footnote.
  const askBox = await ask.boundingBox();
  const firstHeading = await page.locator(".cave-reader-doc h2").first().boundingBox();
  expect(askBox!.y).toBeLessThan(firstHeading!.y);
});

test("Edit opens the prompt for editing and Cancel puts it back", async ({ page }) => {
  await openReader(page, { text: CITED_ANSWER, tools: TOOLS });
  const ask = page.locator(".cave-reader-ask");

  await ask.getByRole("button", { name: /Edit & rerun/i }).click();
  const input = ask.locator(".cave-reader-ask__input");
  await expect(input).toHaveValue(USER_PROMPT);
  // The prose form is replaced while editing, not duplicated beside it.
  await expect(ask.locator(".cave-reader-ask__text")).toHaveCount(0);

  await input.fill("");
  // An empty prompt cannot be rerun — there is nothing to send.
  await expect(ask.getByRole("button", { name: "Rerun this turn" })).toBeDisabled();

  await ask.getByRole("button", { name: "Cancel" }).click();
  await expect(ask.locator(".cave-reader-ask__input")).toHaveCount(0);
  await expect(ask.locator(".cave-reader-ask__text")).toHaveText(USER_PROMPT);
});
