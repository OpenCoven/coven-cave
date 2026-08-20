import { expect, test, type Page } from "@playwright/test";

const ISO = "2026-08-19T14:00:00.000Z";
const ORIGINAL_ONE = "https://github.com/OpenCoven/coven-cave/pull/4242/";
const ORIGINAL_TWO = "https://github.com/OpenCoven/coven-cave/pull/4243/";
const CANONICAL_ONE = "https://github.com/OpenCoven/coven-cave/pull/4242";
const CANONICAL_TWO = "https://github.com/OpenCoven/coven-cave/pull/4243";
const agenticRecommendationsEnabled = ["1", "true", "yes", "on"].includes(
  process.env.NEXT_PUBLIC_CAVE_AGENTIC_RECOMMENDATIONS?.trim().toLowerCase() ?? "",
);

const familiar = {
  id: "nova",
  display_name: "Nova",
  role: "Orchestrator",
  status: "active",
  icon: "ph:sparkle-fill",
};

type FixtureProposal = Record<string, unknown>;
type FixtureCard = ReturnType<typeof baseCard>;

function recommendation(
  id: string,
  kind: string,
  payload: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    surface: "board",
    kind,
    payload,
    rationale: "It preserves the task's evidence and keeps the next action reviewable.",
    inferredGoal: "Make release work ready to review.",
    rankReasons: ["The linked pull request is the exact delivery evidence."],
    evidenceRefs: [{ id: "OpenCoven/coven-cave#4242", kind: "github", label: "PR #4242" }],
    contextFingerprint: "ctx-normalized",
    verification: {
      status: "proposal",
      checks: [{ id: "context-fingerprint", state: "passed", detail: "The task context is current." }],
    },
    application: { mode: "review", requiresApproval: true, reversible: false },
    ...overrides,
  };
}

function proposal(
  id: string,
  state: string,
  recommendationValue: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
): FixtureProposal {
  return {
    id,
    recommendation: recommendationValue,
    patch: null,
    state,
    context: {
      fingerprint: "ctx-normalized",
      cardUpdatedAt: ISO,
      taskIds: ["card-governed"],
      githubRefs: ["OpenCoven/coven-cave#4242"],
    },
    evidence: [{
      id: "OpenCoven/coven-cave#4242",
      kind: "github",
      label: "PR #4242",
      resolvedId: "pr-4242",
    }],
    validation: {
      status: state === "blocked" ? "blocked" : "proposal",
      checks: [{ id: "context-fingerprint", state: "passed", detail: "The task context is current." }],
      errors: [],
    },
    needsHuman: false,
    createdAt: ISO,
    updatedAt: ISO,
    ...overrides,
  };
}

function baseCard(overrides: Record<string, unknown> = {}) {
  return {
    id: "card-governed",
    title: "Ship the governed Board recommendation review",
    notes: "Keep the human-authored release step.",
    status: "inbox",
    priority: "high",
    familiarId: "nova",
    sessionId: null,
    cwd: "/repo/coven-cave",
    links: [ORIGINAL_ONE, ORIGINAL_TWO],
    github: [{
      id: "pr-4242",
      kind: "pr",
      repo: "OpenCoven/coven-cave",
      number: 4242,
      title: "PR #4242",
      url: ORIGINAL_ONE,
      labels: [],
    }, {
      id: "pr-4243",
      kind: "pr",
      repo: "OpenCoven/coven-cave",
      number: 4243,
      title: "PR #4243",
      url: ORIGINAL_TWO,
      labels: [],
    }],
    asana: [],
    labels: [],
    createdAt: ISO,
    updatedAt: ISO,
    lifecycle: "queued",
    lifecycleAt: ISO,
    retryCount: 0,
    maxRetries: 3,
    steps: [],
    dependencies: [{
      id: "release-check",
      kind: "github",
      label: "Wait for release checks",
      ref: "OpenCoven/coven-cave#4242",
      state: "unresolved",
      origin: "human",
      createdAt: ISO,
    }],
    primaryBlockerId: "release-check",
    nextStep: {
      summary: "Review the release checklist",
      requiresApproval: false,
      origin: "human",
      updatedAt: ISO,
    },
    agenticEnhance: { proposals: [], audit: [] },
    ...overrides,
  };
}

function rebase(card: FixtureCard, fingerprint: string): FixtureCard {
  const proposals = (card.agenticEnhance as { proposals: FixtureProposal[] }).proposals;
  return {
    ...card,
    updatedAt: `${ISO}-${fingerprint}`,
    agenticEnhance: {
      ...card.agenticEnhance,
      proposals: proposals.map((entry) => {
        if (
          entry.state !== "auto-applied"
          && entry.state !== "proposed"
          && entry.state !== "blocked"
        ) {
          return entry;
        }
        const recommendationValue = entry.recommendation as Record<string, unknown>;
        return {
          ...entry,
          context: { ...(entry.context as Record<string, unknown>), fingerprint },
          recommendation: { ...recommendationValue, contextFingerprint: fingerprint },
          ...(entry.state === "auto-applied" ? { appliedContextFingerprint: fingerprint } : {}),
        };
      }),
    },
  } as FixtureCard;
}

function familiarGeneratedCard(): FixtureCard {
  const normalOne = recommendation("normalize-one", "canonicalize-reference", {
    referenceId: "pr-4242",
    canonicalUrl: CANONICAL_ONE,
  }, {
    application: { mode: "auto-apply", requiresApproval: false, reversible: true },
    verification: { status: "verified", checks: [{ id: "exact-pr-4242", state: "passed", detail: "PR #4242 resolves exactly." }] },
  });
  const normalTwo = recommendation("normalize-two", "canonicalize-reference", {
    referenceId: "pr-4243",
    canonicalUrl: CANONICAL_TWO,
  }, {
    application: { mode: "auto-apply", requiresApproval: false, reversible: true },
    verification: { status: "verified", checks: [{ id: "exact-pr-4243", state: "passed", detail: "PR #4243 resolves exactly." }] },
  });
  const prose = recommendation("prose-proposal", "prose", {
    cardId: "card-governed",
    patch: { notes: "Verify the merged release through the exact PR evidence." },
  });
  const link = recommendation("link-proposal", "prose", {
    cardId: "card-governed",
    patch: { links: [CANONICAL_ONE, CANONICAL_TWO, "https://github.com/OpenCoven/coven-cave/pull/4244"] },
  });
  const approval = recommendation("approval-proposal", "action", {
    cardId: "card-governed",
    patch: {
      nextStep: {
        summary: "Ask the release owner to approve PR #4242",
        requiresApproval: true,
        origin: "enhance",
        updatedAt: ISO,
      },
    },
  });
  const conflict = recommendation("authorship-conflict", "action", {
    cardId: "card-governed",
    patch: {
      notes: "Replace the human release notes.",
      links: [CANONICAL_ONE, CANONICAL_TWO, "https://github.com/OpenCoven/coven-cave/pull/4244"],
      dependencies: [{
        id: "release-check",
        kind: "github",
        label: "Wait for release checks",
        ref: "OpenCoven/coven-cave#4243",
        state: "resolved",
        origin: "enhance",
        createdAt: ISO,
      }],
      primaryBlockerId: "release-check",
      primaryBlockerPinned: true,
      nextStep: {
        summary: "Review the release checklist",
        actorFamiliarId: "nova",
        capability: "approve-pr",
        target: "OpenCoven/coven-cave#4242",
        inputs: ["release checklist", "PR #4242"],
        requiresApproval: true,
        origin: "enhance",
        updatedAt: ISO,
      },
    },
  }, {
    verification: { status: "blocked", checks: [{ id: "authorship", state: "failed", detail: "Human next steps cannot be replaced." }] },
  });
  const dismiss = recommendation("dismiss-proposal", "prose", {
    cardId: "card-governed",
    patch: { title: "Dismiss this suggestion" },
  });

  const card = baseCard({
    links: [CANONICAL_ONE, CANONICAL_TWO],
    github: [
      { ...baseCard().github[0], url: CANONICAL_ONE },
      { ...baseCard().github[1], url: CANONICAL_TWO },
    ],
    agenticEnhance: {
      proposals: [
        proposal("normalize-one", "auto-applied", normalOne, {
          patch: { links: [CANONICAL_ONE, ORIGINAL_TWO] },
          scopedInverse: {
            kind: "canonicalize-reference",
            referenceId: "pr-4242",
            previousUrl: ORIGINAL_ONE,
            appliedUrl: CANONICAL_ONE,
          },
          appliedContextFingerprint: "ctx-normalized",
        }),
        proposal("normalize-two", "auto-applied", normalTwo, {
          patch: { links: [CANONICAL_ONE, CANONICAL_TWO] },
          scopedInverse: {
            kind: "canonicalize-reference",
            referenceId: "pr-4243",
            previousUrl: ORIGINAL_TWO,
            appliedUrl: CANONICAL_TWO,
          },
          appliedContextFingerprint: "ctx-normalized",
        }),
        proposal("prose-proposal", "proposed", prose, {
          patch: { notes: "Verify the merged release through the exact PR evidence." },
        }),
        proposal("link-proposal", "proposed", link, {
          patch: { links: [CANONICAL_ONE, CANONICAL_TWO, "https://github.com/OpenCoven/coven-cave/pull/4244"] },
        }),
        proposal("approval-proposal", "blocked", approval, {
          validation: {
            status: "blocked",
            checks: [{ id: "approval-authorship", state: "failed", detail: "Human next steps cannot be replaced." }],
            errors: [{
              code: "next_step_authorship",
              field: "nextStep",
              message: "Human-authored next steps are proposed for review, never overwritten.",
            }],
          },
          needsHuman: true,
        }),
        proposal("authorship-conflict", "blocked", conflict, {
          validation: {
            status: "blocked",
            checks: [{ id: "authorship", state: "failed", detail: "Human next steps cannot be replaced." }],
            errors: [{
              code: "next_step_authorship",
              field: "nextStep",
              message: "Human-authored next steps are proposed for review, never overwritten.",
            }],
          },
        }),
        proposal("dismiss-proposal", "proposed", dismiss, {
          patch: { title: "Dismiss this suggestion" },
        }),
        proposal("stale-proposal", "proposed", recommendation("stale-proposal", "prose", {
          cardId: "card-governed",
          patch: { title: "This response is stale" },
        }), {
          patch: { title: "This response is stale" },
        }),
      ],
      audit: [],
    },
  });
  return rebase(card, "ctx-normalized");
}

async function openBoard(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("cave:onboarding:dismissed", "1");
    window.localStorage.setItem("cave:active-familiar", "nova");
  });
  await page.route("**/api/familiars**", (route) =>
    route.fulfill({ json: { ok: true, familiars: [familiar] } }),
  );
  await page.route("**/api/sessions/list**", (route) => route.fulfill({ json: { ok: true, sessions: [] } }));
  await page.route("**/api/chat/model-state**", (route) => route.fulfill({
    json: {
      ok: true,
      state: {
        familiarId: "nova",
        runtime: null,
        harness: "claude",
        effectiveModel: "",
        source: "familiar-default",
        applicationState: "saved",
        reason: "e2e",
      },
    },
  }));
  await page.route("**/api/chat/usage**", (route) => route.fulfill({ json: { ok: true } }));
  await page.route("**/api/roles**", (route) => route.fulfill({ json: { ok: true, roles: [] } }));
  await page.route("**/api/projects**", (route) => route.fulfill({ json: { ok: true, projects: [] } }));
  await page.goto("/?mode=board");
  await expect(page.locator(".board-shell")).toBeVisible({ timeout: 120_000 });
}

async function refreshBoard(page: Page, boardReads: () => number) {
  const priorReads = boardReads();
  await page.waitForTimeout(1_600);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(boardReads).toBeGreaterThan(priorReads);
}

async function openInspector(page: Page) {
  await page.getByRole("button", { name: /Ship the governed Board recommendation review/ }).click();
  const dialog = page.getByRole("dialog", { name: "Card inspector" });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function debugCard(dialog: ReturnType<Page["getByRole"]>) {
  const show = dialog.getByTitle("Show debug details");
  if (await show.count()) await show.click();
  return dialog.locator("pre").last();
}

test("keeps Board recommendations hidden and idle when the capability is disabled", async ({ page }) => {
  test.skip(agenticRecommendationsEnabled, "this behavioral gate runs in the disabled capability build");
  let recommendationRequests = 0;
  await page.route("**/api/board", (route) =>
    route.fulfill({ json: { ok: true, cards: [baseCard()] } }),
  );
  await page.route("**/api/board/card-governed/enhance", (route) => {
    recommendationRequests += 1;
    return route.fulfill({ status: 500, json: { ok: false } });
  });

  await openBoard(page);
  const dialog = await openInspector(page);
  await expect(dialog.getByRole("button", { name: "Generate recommendations" })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Regenerate recommendations" })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Review enhancements" })).toHaveCount(0);
  await page.waitForTimeout(800);
  expect(recommendationRequests).toBe(0);
});

test.describe("governed Board Enhance", () => {
  test.skip(!agenticRecommendationsEnabled, "run with NEXT_PUBLIC_CAVE_AGENTIC_RECOMMENDATIONS=1");

  test("generates persisted proposals, explains exact diffs, and applies governed independent reversions", async ({ page }) => {
    test.slow();
    let liveCard: FixtureCard = baseCard();
    let boardReads = 0;
    let generationAttempts = 0;
    const mutations: Array<{ intent: string; action?: string; proposalId?: string; fingerprint?: string }> = [];

    await page.route("**/api/board", (route) => {
      boardReads += 1;
      return route.fulfill({ json: { ok: true, cards: [liveCard] } });
    });
    await page.route("**/api/board/card-governed/enhance", async (route) => {
      const body = route.request().postDataJSON() as {
        intent: string;
        action: string;
        output?: string;
        familiarId?: string;
        model?: string;
        proposalId?: string;
        contextFingerprint?: string;
      };
      mutations.push({
        intent: body.intent,
        action: body.action,
        proposalId: body.proposalId,
        fingerprint: body.contextFingerprint,
      });
      expect(await route.request().headerValue("x-coven-cave-intent")).toBe("board-agentic-enhance");

      if (body.intent === "generate") {
        expect(body.action).toBeUndefined();
        expect(body.familiarId).toBe("nova");
        expect(body.model).toBeUndefined();
        expect(Object.hasOwn(body, "output")).toBe(false);
        generationAttempts += 1;
        if (generationAttempts === 1) {
          await route.fulfill({ status: 409, json: { ok: false, error: "stale_context" } });
          return;
        }
        if (generationAttempts === 2) {
          await route.fulfill({ status: 500, json: { ok: false, error: "familiar_unavailable" } });
          return;
        }
        liveCard = familiarGeneratedCard();
        await route.fulfill({ json: { ok: true, card: liveCard } });
        return;
      }

      if (body.proposalId === "stale-proposal") {
        await route.fulfill({ status: 409, json: { ok: false, error: "stale_context" } });
        return;
      }

      const currentEntry = (liveCard.agenticEnhance as { proposals: FixtureProposal[] }).proposals
        .find((proposal) => proposal.id === body.proposalId)!;
      const currentFingerprint = (currentEntry.context as { fingerprint: string }).fingerprint;
      expect(body.contextFingerprint).toBe(currentFingerprint);
      const next = structuredClone(liveCard) as FixtureCard;
      const proposals = (next.agenticEnhance as { proposals: FixtureProposal[] }).proposals;
      const entry = proposals.find((proposal) => proposal.id === body.proposalId)!;

      if (body.action === "dismiss") {
        entry.state = "dismissed";
      } else if (body.action === "revert" && body.proposalId === "normalize-one") {
        entry.state = "reverted";
        next.links = [ORIGINAL_ONE, CANONICAL_TWO];
        next.github[0] = { ...next.github[0], url: ORIGINAL_ONE };
        liveCard = rebase(next, "ctx-after-first-revert");
        await route.fulfill({ json: { ok: true, card: liveCard } });
        return;
      } else if (body.action === "revert" && body.proposalId === "normalize-two") {
        entry.state = "reverted";
        next.links = [ORIGINAL_ONE, ORIGINAL_TWO];
        next.github[1] = { ...next.github[1], url: ORIGINAL_TWO };
        liveCard = rebase(next, "ctx-after-second-revert");
        await route.fulfill({ json: { ok: true, card: liveCard } });
        return;
      } else if (body.action === "apply" && body.proposalId === "prose-proposal") {
        entry.state = "applied";
        next.notes = "Verify the merged release through the exact PR evidence.";
      }
      liveCard = next;
      await route.fulfill({ json: { ok: true, card: liveCard } });
    });

    await openBoard(page);
    let dialog = await openInspector(page);
    await dialog.getByLabel("Enhance actions").getByRole("button", { name: "Generate recommendations" }).click();
    const panel = dialog.getByRole("region", { name: "Enhance recommendations" });
    await expect(panel).toBeFocused();
    await expect(panel.getByRole("alert")).toHaveText(
      "The task changed before recommendations could be generated. Try Enhance again.",
    );
    await panel.getByRole("button", { name: "Generate recommendations" }).click();
    await expect(panel.getByRole("alert")).toHaveText("Recommendations could not be generated. Try Enhance again.");
    await panel.getByRole("button", { name: "Generate recommendations" }).click();
    await expect(dialog.getByRole("article", { name: "Enhancement: prose-proposal" })).toBeVisible();

    await dialog.getByLabel("Close", { exact: true }).click();
    await refreshBoard(page, () => boardReads);
    dialog = await openInspector(page);
    await dialog.getByRole("button", { name: "Review enhancements" }).click();

    const conflict = dialog.getByRole("article", { name: "Enhancement: authorship-conflict" });
    await expect(conflict.getByText("Human authorship conflict")).toBeVisible();
    await expect(conflict.getByText("Current").first()).toBeVisible();
    await expect(conflict.getByText("Proposed").first()).toBeVisible();
    await expect(conflict.getByText("Keep the human-authored release step.", { exact: true }).first()).toBeVisible();
    await expect(conflict.getByText("Replace the human release notes.", { exact: true })).toBeVisible();
    await expect(conflict.getByText(/reference: OpenCoven\/coven-cave#4242/).first()).toBeVisible();
    await expect(conflict.getByText(/reference: OpenCoven\/coven-cave#4243/).first()).toBeVisible();
    await expect(conflict.getByText(/state: unresolved/).first()).toBeVisible();
    await expect(conflict.getByText(/state: resolved/).first()).toBeVisible();
    await expect(conflict.getByText(/summary: Review the release checklist/).first()).toBeVisible();
    await expect(conflict.getByText(/actor: nova/).first()).toBeVisible();
    await expect(conflict.getByText(/capability: approve-pr/).first()).toBeVisible();
    await expect(conflict.getByText(/target: OpenCoven\/coven-cave#4242/).first()).toBeVisible();
    await expect(conflict.getByText(/inputs: release checklist, PR #4242/).first()).toBeVisible();
    await expect(conflict.getByText("Not pinned", { exact: true })).toBeVisible();
    await expect(conflict.getByText("Pinned", { exact: true })).toBeVisible();
    const link = dialog.getByRole("article", { name: "Enhancement: link-proposal" });
    await expect(link.getByText(/Added: https:\/\/github\.com\/OpenCoven\/coven-cave\/pull\/4244/)).toBeVisible();

    await dialog.getByTitle("Show lifecycle details").click();
    await expect(dialog.getByRole("button", { name: "dispatch", exact: true })).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "cancel", exact: true })).toBeVisible();

    const dismissed = dialog.getByRole("article", { name: "Enhancement: dismiss-proposal" });
    await dismissed.getByRole("button", { name: "Dismiss proposal" }).click();
    await expect(dismissed.getByText("Dismissed")).toBeVisible();

    const first = dialog.getByRole("article", { name: "Enhancement: normalize-one" });
    const second = dialog.getByRole("article", { name: "Enhancement: normalize-two" });
    await first.getByRole("button", { name: "Revert normalization" }).click();
    await expect(first.getByText("Reverted")).toBeVisible();
    let debug = await debugCard(dialog);
    await expect(debug).toContainText(ORIGINAL_ONE);
    await expect(debug).toContainText(CANONICAL_TWO);

    await second.getByRole("button", { name: "Revert normalization" }).click();
    await expect(second.getByText("Reverted")).toBeVisible();
    debug = await debugCard(dialog);
    await expect(debug).toContainText(ORIGINAL_ONE);
    await expect(debug).toContainText(ORIGINAL_TWO);

    const stale = dialog.getByRole("article", { name: "Enhancement: stale-proposal" });
    await stale.getByRole("button", { name: "Apply proposal" }).click();
    await expect(stale.getByRole("alert")).toHaveText("This proposal is out of date. Refresh the card before applying it.");
    await expect(stale.getByRole("button", { name: "Apply proposal" })).toBeDisabled();

    const prose = dialog.getByRole("article", { name: "Enhancement: prose-proposal" });
    await prose.getByRole("button", { name: "Apply proposal" }).click();
    await expect(prose.getByText("Applied")).toBeVisible();

    await dialog.getByLabel("Close", { exact: true }).click();
    await refreshBoard(page, () => boardReads);
    dialog = await openInspector(page);
    debug = await debugCard(dialog);
    await expect(debug).toContainText("Verify the merged release through the exact PR evidence.");
    await expect(debug).toContainText(ORIGINAL_ONE);
    await expect(debug).toContainText(ORIGINAL_TWO);

    expect(mutations).toEqual([
      { intent: "generate", action: undefined, proposalId: undefined, fingerprint: undefined },
      { intent: "generate", action: undefined, proposalId: undefined, fingerprint: undefined },
      { intent: "generate", action: undefined, proposalId: undefined, fingerprint: undefined },
      { intent: "board-agentic-enhance", action: "dismiss", proposalId: "dismiss-proposal", fingerprint: "ctx-normalized" },
      { intent: "board-agentic-enhance", action: "revert", proposalId: "normalize-one", fingerprint: "ctx-normalized" },
      { intent: "board-agentic-enhance", action: "revert", proposalId: "normalize-two", fingerprint: "ctx-after-first-revert" },
      { intent: "board-agentic-enhance", action: "apply", proposalId: "stale-proposal", fingerprint: "ctx-after-second-revert" },
      { intent: "board-agentic-enhance", action: "apply", proposalId: "prose-proposal", fingerprint: "ctx-after-second-revert" },
    ]);
  });

  test("regenerates after a task changes while retaining prior proposal history", async ({ page }) => {
    test.slow();
    const audit = (proposalId: string, fingerprint: string) => ({
      proposalId,
      action: "generated",
      actor: "enhance",
      at: ISO,
      context: { fingerprint, cardUpdatedAt: ISO, taskIds: ["card-governed"], githubRefs: [] },
      evidence: [],
      validation: { status: "proposal", checks: [], errors: [] },
    });
    const historyRecommendation = recommendation("history-proposal", "prose", {
      cardId: "card-governed",
      patch: { notes: "First generated recommendation." },
    });
    const currentRecommendation = recommendation("current-proposal", "prose", {
      cardId: "card-governed",
      patch: { notes: "Current generated recommendation." },
    });
    let liveCard: FixtureCard = baseCard();
    let generationCount = 0;
    let boardReads = 0;

    await page.route("**/api/board", (route) => {
      boardReads += 1;
      return route.fulfill({ json: { ok: true, cards: [liveCard] } });
    });
    await page.route("**/api/board/card-governed/enhance", async (route) => {
      const body = route.request().postDataJSON() as { intent?: string };
      expect(body.intent).toBe("generate");
      expect(Object.hasOwn(body, "output")).toBe(false);
      generationCount += 1;
      if (generationCount === 1) {
        liveCard = {
          ...baseCard(),
          agenticEnhance: {
            proposals: [proposal("history-proposal", "proposed", historyRecommendation, {
              patch: { notes: "First generated recommendation." },
            })],
            audit: [audit("history-proposal", "ctx-first")],
          },
        } as FixtureCard;
      } else if (generationCount === 2) {
        await route.fulfill({ status: 409, json: { ok: false, error: "stale_context" } });
        return;
      } else if (generationCount === 3) {
        await route.fulfill({ status: 500, json: { ok: false, error: "familiar_unavailable" } });
        return;
      } else {
        liveCard = {
          ...liveCard,
          agenticEnhance: {
            proposals: [
              ...(liveCard.agenticEnhance as { proposals: FixtureProposal[] }).proposals,
              proposal("current-proposal", "proposed", currentRecommendation, {
                context: {
                  fingerprint: "ctx-current",
                  cardUpdatedAt: ISO,
                  taskIds: ["card-governed"],
                  githubRefs: [],
                },
                recommendation: { ...currentRecommendation, contextFingerprint: "ctx-current" },
                patch: { notes: "Current generated recommendation." },
              }),
            ],
            audit: [
              ...(liveCard.agenticEnhance as { audit: unknown[] }).audit,
              audit("current-proposal", "ctx-current"),
            ],
          },
        } as FixtureCard;
      }
      await route.fulfill({ json: { ok: true, card: liveCard } });
    });

    await openBoard(page);
    let dialog = await openInspector(page);
    const actions = dialog.getByLabel("Enhance actions");
    await actions.getByRole("button", { name: "Generate recommendations" }).click();
    await expect(dialog.getByRole("article", { name: "Enhancement: history-proposal" })).toBeVisible();

    const changed = structuredClone(liveCard) as FixtureCard;
    changed.notes = "Task context changed after the first generation.";
    const historical = (changed.agenticEnhance as { proposals: FixtureProposal[] }).proposals[0]!;
    historical.state = "blocked";
    historical.validation = {
      status: "blocked",
      checks: [],
      errors: [{
        code: "stale_context",
        message: "The task changed before this proposal could be applied.",
      }],
    };
    liveCard = changed;

    await dialog.getByLabel("Close", { exact: true }).click();
    await refreshBoard(page, () => boardReads);
    dialog = await openInspector(page);
    await dialog.getByRole("button", { name: "Review enhancements" }).click();
    await expect(dialog.getByRole("article", { name: "Enhancement: history-proposal" })).toContainText("Blocked");

    await dialog.getByLabel("Enhance actions").getByRole("button", { name: "Regenerate recommendations" }).click();
    await expect(dialog.getByRole("alert")).toHaveText(
      "The task changed before recommendations could be generated. Try Enhance again.",
    );
    await dialog.getByLabel("Enhance actions").getByRole("button", { name: "Regenerate recommendations" }).click();
    await expect(dialog.getByRole("alert")).toHaveText("Recommendations could not be generated. Try Enhance again.");
    await dialog.getByLabel("Enhance actions").getByRole("button", { name: "Regenerate recommendations" }).click();
    await expect(dialog.getByRole("article", { name: "Enhancement: history-proposal" })).toContainText("Blocked");
    await expect(dialog.getByRole("article", { name: "Enhancement: current-proposal" })).toBeVisible();
    const debug = await debugCard(dialog);
    await expect(debug).toContainText("history-proposal");
    await expect(debug).toContainText("current-proposal");
    expect(generationCount).toBe(4);
  });

  test("generic needs-human recovery retains Retry and Cancel", async ({ page }) => {
    test.slow();
    const failed = baseCard({
      id: "card-failed",
      title: "Recover a failed task",
      status: "blocked",
      lifecycle: "failed",
      needsHuman: true,
      nextStep: null,
      agenticEnhance: { proposals: [], audit: [] },
    });
    await page.route("**/api/board", (route) => route.fulfill({ json: { ok: true, cards: [failed] } }));
    await openBoard(page);
    await page.getByRole("button", { name: /Recover a failed task/ }).click();
    const dialog = page.getByRole("dialog", { name: "Card inspector" });
    await dialog.getByTitle("Show lifecycle details").click();
    await expect(dialog.getByRole("button", { name: "retry", exact: true })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "cancel", exact: true })).toBeVisible();
  });

  test("renders malformed blocked payloads without dereferencing them", async ({ page }) => {
    test.slow();
    const malformed = baseCard({
      id: "card-malformed",
      title: "Review malformed Board proposal",
      agenticEnhance: {
        proposals: [{
          id: "malformed-proposal",
          recommendation: recommendation("malformed-proposal", "dependency", {
            cardId: "card-malformed",
            patch: {
              title: { unexpected: true },
              links: [null, { unexpected: true }],
              github: [null, { labels: null }],
              dependencies: [null, { id: 42, label: ["not", "text"] }],
              primaryBlockerId: { id: "not-a-string" },
              primaryBlockerPinned: "not-a-boolean",
              nextStep: { summary: ["not", "text"], inputs: "not-an-array" },
            },
          }, {
            verification: {
              status: "blocked",
              checks: [{ id: "payload", state: "failed", detail: "Payload fields are malformed." }],
            },
          }),
          patch: null,
          state: "blocked",
          context: {
            fingerprint: "ctx-malformed",
            cardUpdatedAt: ISO,
            taskIds: ["card-malformed"],
            githubRefs: [],
          },
          evidence: [],
          validation: {
            status: "blocked",
            checks: [{ id: "payload", state: "failed", detail: "Payload fields are malformed." }],
            errors: [{ code: "invalid_payload", message: "Payload fields are malformed." }],
          },
          needsHuman: false,
          createdAt: ISO,
          updatedAt: ISO,
        }],
        audit: [],
      },
    });
    await page.route("**/api/board", (route) => route.fulfill({ json: { ok: true, cards: [malformed] } }));
    await openBoard(page);
    await page.getByRole("button", { name: /Review malformed Board proposal/ }).click();
    const dialog = page.getByRole("dialog", { name: "Card inspector" });
    await dialog.getByRole("button", { name: "Review enhancements" }).click();
    const proposal = dialog.getByRole("article", { name: "Enhancement: malformed-proposal" });
    await expect(proposal.getByText("Payload fields are malformed.", { exact: true }).first()).toBeVisible();
    await expect(proposal.getByText("Invalid dependency: null", { exact: true }).first()).toBeVisible();
    await expect(proposal.getByText("Invalid GitHub reference: null", { exact: true }).first()).toBeVisible();
    await expect(proposal.getByText(/summary: \["not","text"\]/).first()).toBeVisible();
    await expect(proposal.getByText(/Invalid inputs: not-an-array/).first()).toBeVisible();
    await expect(proposal.getByText(/Invalid pin:/).first()).toBeVisible();
  });

  test("prevents reverse-order response races by locking proposal controls", async ({ page }) => {
    test.slow();
    let release: () => void = () => {};
    let requests = 0;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const generated = familiarGeneratedCard();
    await page.route("**/api/board", (route) => route.fulfill({ json: { ok: true, cards: [generated] } }));
    await page.route("**/api/board/card-governed/enhance", async (route) => {
      requests += 1;
      await pending;
      await route.fulfill({ json: { ok: true, card: generated } });
    });
    await openBoard(page);
    const dialog = await openInspector(page);
    await dialog.getByRole("button", { name: "Review enhancements" }).click();
    const first = dialog.getByRole("article", { name: "Enhancement: normalize-one" });
    const second = dialog.getByRole("article", { name: "Enhancement: normalize-two" });
    await first.getByRole("button", { name: "Revert normalization" }).click();
    await expect(second.getByRole("button", { name: "Revert normalization" })).toBeDisabled();
    release();
    await expect(first.getByText("Applied normalization")).toBeVisible();
    expect(requests).toBe(1);
  });
});
