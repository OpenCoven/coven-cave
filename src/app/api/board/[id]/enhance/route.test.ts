import assert from "node:assert/strict";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import type { AgenticDiagnosticEvent, AgenticDiagnosticSink } from "@/lib/agentic-diagnostics.ts";

const testHome = path.join(process.cwd(), ".test-state-board-agentic-enhance-route");
await rm(testHome, { recursive: true, force: true });
await mkdir(testHome, { recursive: true });
process.env.COVEN_CAVE_HOME = testHome;
process.env.COVEN_HOME = path.join(testHome, ".coven");

try {
  const board = await import("../../../../../lib/cave-board.ts");
  const enhance = await import("../../../../../lib/board-agentic-enhance.ts");
  const { POST: productionPOST, createBoardEnhanceRoute } = await import("./route.ts");

  function request(
    id: string,
    body: unknown,
  ): Request {
    return new Request(`http://127.0.0.1/api/board/${id}/enhance`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-coven-cave-intent": "board-agentic-enhance",
      },
      body: JSON.stringify(body),
    });
  }

  function output(recommendations: unknown[]) {
    return JSON.stringify({ recommendations });
  }

  function invalidJsonRequest(id: string): Request {
    return new Request(`http://127.0.0.1/api/board/${id}/enhance`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-coven-cave-intent": "board-agentic-enhance",
      },
      body: "{",
    });
  }

  function mockedFamiliarRoute(
    responses: string[],
    onCall?: () => Promise<void>,
    diagnostics?: AgenticDiagnosticSink,
  ) {
    const calls: unknown[][] = [];
    const route = createBoardEnhanceRoute({
      loadBoard: board.loadBoard,
      loadConfig: async () => ({}) as never,
      bindingFor: () => ({ harness: "codex" }) as never,
      isTrustedHarness: () => true,
      resolveWorkspace: async () => undefined,
      supportsModel: async () => true,
      diagnostics,
      runFamiliar: async (...args: unknown[]) => {
        calls.push(args);
        await onCall?.();
        return responses.shift() ?? "";
      },
    });
    return { calls, route };
  }

  async function POST(
    req: Request,
    params: { params: Promise<{ id: string }> },
    diagnostics?: AgenticDiagnosticSink,
  ) {
    const body = await req.clone().json().catch(() => null) as Record<string, unknown> | null;
    if (body?.action === "generate" && typeof body.output === "string") {
      const generated = mockedFamiliarRoute([body.output], undefined, diagnostics);
      const mockedRequest = new Request(req.url, {
        method: req.method,
        headers: req.headers,
        body: JSON.stringify({
          ...body,
          familiarId: typeof body.familiarId === "string" ? body.familiarId : "nyx",
        }),
        signal: req.signal,
      });
      return generated.route(mockedRequest, params);
    }
    return productionPOST(req, params);
  }

  function recommendation(
    card: Awaited<ReturnType<typeof board.createCard>>,
    fingerprint: string,
    overrides: Record<string, unknown> = {},
  ) {
    return {
      id: "proposal-apply",
      surface: "board",
      kind: "action",
      payload: {
        cardId: card.id,
        patch: {
          nextStep: {
            summary: "Ask the maintainer to approve the release",
            requiresApproval: true,
            origin: "enhance",
            updatedAt: "2026-08-19T14:00:00.000Z",
          },
        },
      },
      rationale: "A named approver keeps the task governed.",
      inferredGoal: "Make the next action explicit.",
      rankReasons: ["The approval boundary is unresolved."],
      evidenceRefs: [{ id: `task:${card.id}`, kind: "task", label: card.title }],
      contextFingerprint: fingerprint,
      ...overrides,
    };
  }

  const approvalTarget = await board.createCard({ title: "Approval target" });
  const approvalContext = enhance.buildBoardAgenticContext(approvalTarget, [approvalTarget]);
  const invalidJson = await POST(
    invalidJsonRequest(approvalTarget.id),
    { params: Promise.resolve({ id: approvalTarget.id }) },
  );
  assert.equal(invalidJson.status, 400);
  assert.equal((await invalidJson.json()).error, "invalid json body");
  const generated = await POST(
    request(approvalTarget.id, {
      intent: "board-agentic-enhance",
      action: "generate",
      output: output([recommendation(approvalTarget, approvalContext.fingerprint)]),
    }),
    { params: Promise.resolve({ id: approvalTarget.id }) },
  );
  assert.equal(generated.status, 200);
  const generatedBody = await generated.json();
  assert.equal(generatedBody.card.nextStep, null, "generation persists a proposal without changing task fields");
  assert.equal(generatedBody.card.agenticEnhance.proposals[0].state, "proposed");
  assert.equal(generatedBody.card.agenticEnhance.audit.at(-1).action, "generated");

  const forgedApply = await POST(
    request(approvalTarget.id, {
      intent: "board-agentic-enhance",
      action: "apply",
      proposalId: "proposal-apply",
      contextFingerprint: approvalContext.fingerprint,
      patch: { title: "Forged task mutation" },
      automatic: true,
    }),
    { params: Promise.resolve({ id: approvalTarget.id }) },
  );
  assert.equal(forgedApply.status, 400);
  assert.equal((await forgedApply.json()).error, "invalid apply intent");

  const applied = await POST(
    request(approvalTarget.id, {
      intent: "board-agentic-enhance",
      action: "apply",
      proposalId: "proposal-apply",
      contextFingerprint: approvalContext.fingerprint,
      actor: "reviewer",
    }),
    { params: Promise.resolve({ id: approvalTarget.id }) },
  );
  assert.equal(applied.status, 200);
  const appliedBody = await applied.json();
  assert.equal(appliedBody.card.nextStep.requiresApproval, true);
  assert.equal(appliedBody.card.needsHuman, true, "approval-bound next steps retain human attention");
  assert.equal(appliedBody.card.lifecycle, "queued", "applying a proposal never dispatches a task");
  assert.equal(appliedBody.card.agenticEnhance.proposals[0].state, "applied");
  assert.equal(appliedBody.card.agenticEnhance.audit.at(-1).action, "applied");

  const danglingTarget = await board.createCard({ title: "Dangling proposal target" });
  const danglingBoard = await board.loadBoard();
  const danglingCurrent = danglingBoard.cards.find((card) => card.id === danglingTarget.id)!;
  const danglingContext = enhance.buildBoardAgenticContext(danglingCurrent, danglingBoard.cards);
  const blockedDiagnostics: AgenticDiagnosticEvent[] = [];
  const dangling = await POST(
    request(danglingTarget.id, {
      intent: "board-agentic-enhance",
      action: "generate",
      output: output([recommendation(danglingTarget, danglingContext.fingerprint, {
        id: "proposal-dangling",
        kind: "dependency",
        payload: {
          cardId: danglingTarget.id,
          patch: {
            dependencies: [{
              id: "missing-task",
              kind: "task",
              taskId: "does-not-exist",
              label: "Wait for a missing task",
              state: "unresolved",
              origin: "enhance",
              createdAt: "2026-08-19T14:00:00.000Z",
            }],
          },
        },
      })]),
    }),
    { params: Promise.resolve({ id: danglingTarget.id }) },
    (event) => blockedDiagnostics.push(event),
  );
  assert.equal(dangling.status, 200, "blocked proposals remain persisted for review");
  const danglingBody = await dangling.json();
  assert.equal(danglingBody.card.agenticEnhance.proposals[0].state, "blocked");
  assert.ok(
    danglingBody.card.agenticEnhance.proposals[0].validation.errors.some(
      (error: { code: string }) => error.code === "dependency_dangling",
    ),
  );
  assert.deepEqual(
    blockedDiagnostics.map((event) => event.code),
    ["verification_blocked"],
  );

  const blockedApply = await POST(
    request(danglingTarget.id, {
      intent: "board-agentic-enhance",
      action: "apply",
      proposalId: "proposal-dangling",
      contextFingerprint: danglingContext.fingerprint,
    }),
    { params: Promise.resolve({ id: danglingTarget.id }) },
  );
  assert.equal(blockedApply.status, 422);
  assert.equal((await blockedApply.json()).error, "orchestration_invalid");

  const staleDiagnostics: AgenticDiagnosticEvent[] = [];
  const stale = await POST(
    request(danglingTarget.id, {
      intent: "board-agentic-enhance",
      action: "generate",
      output: output([recommendation(danglingTarget, "ctx-v1-00000000000000000000000000000000", {
        id: "proposal-stale",
      })]),
    }),
    { params: Promise.resolve({ id: danglingTarget.id }) },
    (event) => staleDiagnostics.push(event),
  );
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).error, "stale_context");
  assert.deepEqual(
    staleDiagnostics.map((event) => [event.code, event.status]),
    [["stale_discarded", "discarded"]],
  );

  const applyFailureDiagnostics: AgenticDiagnosticEvent[] = [];
  const applyFailureRoute = mockedFamiliarRoute([], undefined, (event) => applyFailureDiagnostics.push(event));
  const applyFailure = await applyFailureRoute.route(
    request(danglingTarget.id, {
      intent: "board-agentic-enhance",
      action: "apply",
      proposalId: "proposal-missing",
      contextFingerprint: danglingContext.fingerprint,
    }),
    { params: Promise.resolve({ id: danglingTarget.id }) },
  );
  assert.equal(applyFailure.status, 404);
  assert.deepEqual(
    applyFailureDiagnostics.map((event) => event.code),
    ["apply_failed"],
  );

  const dismissFailureDiagnostics: AgenticDiagnosticEvent[] = [];
  const dismissFailureRoute = mockedFamiliarRoute([], undefined, (event) => dismissFailureDiagnostics.push(event));
  const dismissFailure = await dismissFailureRoute.route(
    request(danglingTarget.id, {
      intent: "board-agentic-enhance",
      action: "dismiss",
      proposalId: "proposal-missing",
    }),
    { params: Promise.resolve({ id: danglingTarget.id }) },
  );
  assert.equal(dismissFailure.status, 404);
  assert.deepEqual(
    dismissFailureDiagnostics,
    [],
    "dismissal failures are not apply diagnostics",
  );

  const githubTarget = await board.createCard({
    title: "Canonicalize exact GitHub link",
    links: ["https://github.com/OpenCoven/coven-cave/issues/42/"],
    github: [{
      id: "github:issue:opencoven/coven-cave:42",
      kind: "issue",
      repo: "OpenCoven/coven-cave",
      number: 42,
      title: "Issue 42",
      url: "https://github.com/OpenCoven/coven-cave/issues/42/",
      labels: [],
    }],
  });
  const githubBoard = await board.loadBoard();
  const githubCurrent = githubBoard.cards.find((card) => card.id === githubTarget.id)!;
  const githubContext = enhance.buildBoardAgenticContext(githubCurrent, githubBoard.cards);
  const normalized = await POST(
    request(githubTarget.id, {
      intent: "board-agentic-enhance",
      action: "generate",
      output: output([
        recommendation(githubTarget, githubContext.fingerprint, {
        id: "proposal-normalize",
        kind: "canonicalize-reference",
        payload: {
          referenceId: "github:issue:opencoven/coven-cave:42",
          canonicalUrl: "https://github.com/OpenCoven/coven-cave/issues/42",
        },
        evidenceRefs: [{
          id: "OpenCoven/coven-cave#42",
          kind: "github",
          label: "Issue 42",
        }],
        }),
        recommendation(githubTarget, githubContext.fingerprint, {
          id: "proposal-batch-prose",
          kind: "prose",
          payload: {
            cardId: githubTarget.id,
            patch: { notes: "Review the canonical issue after normalization." },
          },
        }),
      ]),
    }),
    { params: Promise.resolve({ id: githubTarget.id }) },
  );
  assert.equal(normalized.status, 200);
  const normalizedBody = await normalized.json();
  assert.equal(normalizedBody.card.github[0].url, "https://github.com/OpenCoven/coven-cave/issues/42");
  assert.equal(normalizedBody.card.notes, "", "later model proposals stay reviewable after an auto-normalization");
  assert.equal(
    normalizedBody.card.agenticEnhance.proposals.find(
      (proposal: { id: string }) => proposal.id === "proposal-normalize",
    )?.state,
    "auto-applied",
  );
  assert.equal(
    normalizedBody.card.agenticEnhance.proposals.find(
      (proposal: { id: string }) => proposal.id === "proposal-batch-prose",
    )?.state,
    "proposed",
  );
  assert.equal(normalizedBody.card.agenticEnhance.audit.at(-1).action, "auto-applied");

  const normalizedBoard = await board.loadBoard();
  const normalizedCurrent = normalizedBoard.cards.find((card) => card.id === githubTarget.id)!;
  const normalizedContext = enhance.buildBoardAgenticContext(normalizedCurrent, normalizedBoard.cards);
  const proseApplied = await POST(
    request(githubTarget.id, {
      intent: "board-agentic-enhance",
      action: "apply",
      proposalId: "proposal-batch-prose",
      contextFingerprint: normalizedContext.fingerprint,
      actor: "reviewer",
    }),
    { params: Promise.resolve({ id: githubTarget.id }) },
  );
  assert.equal(proseApplied.status, 200, "proposals rebase to the post-normalization fingerprint");
  assert.equal(
    (await proseApplied.json()).card.notes,
    "Review the canonical issue after normalization.",
  );

  const revertThenProseTarget = await board.createCard({
    title: "Rebase prose after normalization revert",
    links: ["https://github.com/OpenCoven/coven-cave/issues/49/"],
    github: [{
      id: "github:issue:opencoven/coven-cave:49",
      kind: "issue",
      repo: "OpenCoven/coven-cave",
      number: 49,
      title: "Issue 49",
      url: "https://github.com/OpenCoven/coven-cave/issues/49/",
      labels: [],
    }],
  });
  const revertThenProseBoard = await board.loadBoard();
  const revertThenProseCurrent = revertThenProseBoard.cards.find(
    (card) => card.id === revertThenProseTarget.id,
  )!;
  const revertThenProseContext = enhance.buildBoardAgenticContext(
    revertThenProseCurrent,
    revertThenProseBoard.cards,
  );
  const revertThenProseGenerated = await POST(
    request(revertThenProseTarget.id, {
      intent: "board-agentic-enhance",
      action: "generate",
      output: output([
        recommendation(revertThenProseTarget, revertThenProseContext.fingerprint, {
          id: "proposal-rebase-normalize",
          kind: "canonicalize-reference",
          payload: {
            referenceId: "github:issue:opencoven/coven-cave:49",
            canonicalUrl: "https://github.com/OpenCoven/coven-cave/issues/49",
          },
          evidenceRefs: [{
            id: "OpenCoven/coven-cave#49",
            kind: "github",
            label: "Issue 49",
          }],
        }),
        recommendation(revertThenProseTarget, revertThenProseContext.fingerprint, {
          id: "proposal-rebase-prose",
          kind: "prose",
          payload: {
            cardId: revertThenProseTarget.id,
            patch: { notes: "Review after the normalization is reverted." },
          },
        }),
      ]),
    }),
    { params: Promise.resolve({ id: revertThenProseTarget.id }) },
  );
  assert.equal(revertThenProseGenerated.status, 200);
  const afterRebaseBatch = await board.loadBoard();
  const afterRebaseBatchCard = afterRebaseBatch.cards.find(
    (card) => card.id === revertThenProseTarget.id,
  )!;
  const afterRebaseBatchContext = enhance.buildBoardAgenticContext(
    afterRebaseBatchCard,
    afterRebaseBatch.cards,
  );
  const revertBeforeProse = await POST(
    request(revertThenProseTarget.id, {
      intent: "board-agentic-enhance",
      action: "revert",
      proposalId: "proposal-rebase-normalize",
      contextFingerprint: afterRebaseBatchContext.fingerprint,
    }),
    { params: Promise.resolve({ id: revertThenProseTarget.id }) },
  );
  assert.equal(revertBeforeProse.status, 200);
  const afterRebaseRevert = await board.loadBoard();
  const afterRebaseRevertCard = afterRebaseRevert.cards.find(
    (card) => card.id === revertThenProseTarget.id,
  )!;
  const afterRebaseRevertContext = enhance.buildBoardAgenticContext(
    afterRebaseRevertCard,
    afterRebaseRevert.cards,
  );
  const proseAfterRevert = await POST(
    request(revertThenProseTarget.id, {
      intent: "board-agentic-enhance",
      action: "apply",
      proposalId: "proposal-rebase-prose",
      contextFingerprint: afterRebaseRevertContext.fingerprint,
    }),
    { params: Promise.resolve({ id: revertThenProseTarget.id }) },
  );
  assert.equal(proseAfterRevert.status, 200);
  assert.equal(
    (await proseAfterRevert.json()).card.notes,
    "Review after the normalization is reverted.",
  );

  const revertTarget = await board.createCard({
    title: "Revert normalized GitHub link",
    links: ["https://github.com/OpenCoven/coven-cave/issues/44/"],
    github: [{
      id: "github:issue:opencoven/coven-cave:44",
      kind: "issue",
      repo: "OpenCoven/coven-cave",
      number: 44,
      title: "Issue 44",
      url: "https://github.com/OpenCoven/coven-cave/issues/44/",
      labels: [],
    }],
  });
  const revertBoard = await board.loadBoard();
  const revertCurrent = revertBoard.cards.find((card) => card.id === revertTarget.id)!;
  const revertContext = enhance.buildBoardAgenticContext(revertCurrent, revertBoard.cards);
  const revertGenerated = await POST(
    request(revertTarget.id, {
      intent: "board-agentic-enhance",
      action: "generate",
      output: output([recommendation(revertTarget, revertContext.fingerprint, {
        id: "proposal-revert-normalize",
        kind: "canonicalize-reference",
        payload: {
          referenceId: "github:issue:opencoven/coven-cave:44",
          canonicalUrl: "https://github.com/OpenCoven/coven-cave/issues/44",
        },
        evidenceRefs: [{
          id: "OpenCoven/coven-cave#44",
          kind: "github",
          label: "Issue 44",
        }],
      })]),
    }),
    { params: Promise.resolve({ id: revertTarget.id }) },
  );
  assert.equal(revertGenerated.status, 200);
  const postNormalizeBoard = await board.loadBoard();
  const postNormalizeCurrent = postNormalizeBoard.cards.find((card) => card.id === revertTarget.id)!;
  const postNormalizeContext = enhance.buildBoardAgenticContext(postNormalizeCurrent, postNormalizeBoard.cards);
  const reverted = await POST(
    request(revertTarget.id, {
      intent: "board-agentic-enhance",
      action: "revert",
      proposalId: "proposal-revert-normalize",
      contextFingerprint: postNormalizeContext.fingerprint,
      actor: "reviewer",
    }),
    { params: Promise.resolve({ id: revertTarget.id }) },
  );
  assert.equal(reverted.status, 200);
  const revertedBody = await reverted.json();
  assert.equal(revertedBody.card.github[0].url, "https://github.com/OpenCoven/coven-cave/issues/44/");
  assert.equal(
    revertedBody.card.agenticEnhance.proposals.find(
      (proposal: { id: string }) => proposal.id === "proposal-revert-normalize",
    )?.state,
    "reverted",
  );
  assert.equal(revertedBody.card.agenticEnhance.audit.at(-1).action, "reverted");

  const dualNormalizationTarget = await board.createCard({
    title: "Apply both verified normalizations",
    links: [
      "https://github.com/OpenCoven/coven-cave/issues/45/",
      "https://github.com/OpenCoven/coven-cave/issues/46/",
    ],
    github: [{
      id: "github:issue:opencoven/coven-cave:45",
      kind: "issue",
      repo: "OpenCoven/coven-cave",
      number: 45,
      title: "Issue 45",
      url: "https://github.com/OpenCoven/coven-cave/issues/45/",
      labels: [],
    }, {
      id: "github:issue:opencoven/coven-cave:46",
      kind: "issue",
      repo: "OpenCoven/coven-cave",
      number: 46,
      title: "Issue 46",
      url: "https://github.com/OpenCoven/coven-cave/issues/46/",
      labels: [],
    }],
  });
  const dualBoard = await board.loadBoard();
  const dualCurrent = dualBoard.cards.find((card) => card.id === dualNormalizationTarget.id)!;
  const dualContext = enhance.buildBoardAgenticContext(dualCurrent, dualBoard.cards);
  const dualGenerated = await POST(
    request(dualNormalizationTarget.id, {
      intent: "board-agentic-enhance",
      action: "generate",
      output: output([45, 46].map((number) => recommendation(
        dualNormalizationTarget,
        dualContext.fingerprint,
        {
          id: `proposal-normalize-${number}`,
          kind: "canonicalize-reference",
          payload: {
            referenceId: `github:issue:opencoven/coven-cave:${number}`,
            canonicalUrl: `https://github.com/OpenCoven/coven-cave/issues/${number}`,
          },
          evidenceRefs: [{
            id: `OpenCoven/coven-cave#${number}`,
            kind: "github",
            label: `Issue ${number}`,
          }],
        },
      ))),
    }),
    { params: Promise.resolve({ id: dualNormalizationTarget.id }) },
  );
  assert.equal(dualGenerated.status, 200);
  const dualBody = await dualGenerated.json();
  assert.deepEqual(
    dualBody.card.github.map((link: { url: string }) => link.url),
    [
      "https://github.com/OpenCoven/coven-cave/issues/45",
      "https://github.com/OpenCoven/coven-cave/issues/46",
    ],
  );
  assert.deepEqual(
    dualBody.card.agenticEnhance.proposals
      .filter((proposal: { id: string }) => proposal.id.startsWith("proposal-normalize-"))
      .map((proposal: { state: string }) => proposal.state),
    ["auto-applied", "auto-applied"],
  );

  const dualAfterBatch = await board.loadBoard();
  const dualAfterBatchCard = dualAfterBatch.cards.find((card) => card.id === dualNormalizationTarget.id)!;
  const dualAfterBatchContext = enhance.buildBoardAgenticContext(dualAfterBatchCard, dualAfterBatch.cards);
  const revertFirstDual = await POST(
    request(dualNormalizationTarget.id, {
      intent: "board-agentic-enhance",
      action: "revert",
      proposalId: "proposal-normalize-45",
      contextFingerprint: dualAfterBatchContext.fingerprint,
    }),
    { params: Promise.resolve({ id: dualNormalizationTarget.id }) },
  );
  assert.equal(revertFirstDual.status, 200);
  assert.deepEqual(
    (await revertFirstDual.json()).card.github.map((link: { url: string }) => link.url),
    [
      "https://github.com/OpenCoven/coven-cave/issues/45/",
      "https://github.com/OpenCoven/coven-cave/issues/46",
    ],
    "reverting the first normalization leaves its sibling applied",
  );
  const dualAfterFirstRevert = await board.loadBoard();
  const dualAfterFirstRevertCard = dualAfterFirstRevert.cards.find(
    (card) => card.id === dualNormalizationTarget.id,
  )!;
  const dualAfterFirstRevertContext = enhance.buildBoardAgenticContext(
    dualAfterFirstRevertCard,
    dualAfterFirstRevert.cards,
  );
  const revertSecondDual = await POST(
    request(dualNormalizationTarget.id, {
      intent: "board-agentic-enhance",
      action: "revert",
      proposalId: "proposal-normalize-46",
      contextFingerprint: dualAfterFirstRevertContext.fingerprint,
    }),
    { params: Promise.resolve({ id: dualNormalizationTarget.id }) },
  );
  assert.equal(revertSecondDual.status, 200);
  assert.deepEqual(
    (await revertSecondDual.json()).card.github.map((link: { url: string }) => link.url),
    [
      "https://github.com/OpenCoven/coven-cave/issues/45/",
      "https://github.com/OpenCoven/coven-cave/issues/46/",
    ],
  );

  const reverseOrderTarget = await board.createCard({
    title: "Revert verified normalizations in reverse order",
    links: [
      "https://github.com/OpenCoven/coven-cave/issues/47/",
      "https://github.com/OpenCoven/coven-cave/issues/48/",
    ],
    github: [47, 48].map((number) => ({
      id: `github:issue:opencoven/coven-cave:${number}`,
      kind: "issue" as const,
      repo: "OpenCoven/coven-cave",
      number,
      title: `Issue ${number}`,
      url: `https://github.com/OpenCoven/coven-cave/issues/${number}/`,
      labels: [],
    })),
  });
  const reverseOrderBoard = await board.loadBoard();
  const reverseOrderCurrent = reverseOrderBoard.cards.find((card) => card.id === reverseOrderTarget.id)!;
  const reverseOrderContext = enhance.buildBoardAgenticContext(reverseOrderCurrent, reverseOrderBoard.cards);
  const reverseOrderGenerated = await POST(
    request(reverseOrderTarget.id, {
      intent: "board-agentic-enhance",
      action: "generate",
      output: output([47, 48].map((number) => recommendation(
        reverseOrderTarget,
        reverseOrderContext.fingerprint,
        {
          id: `proposal-reverse-normalize-${number}`,
          kind: "canonicalize-reference",
          payload: {
            referenceId: `github:issue:opencoven/coven-cave:${number}`,
            canonicalUrl: `https://github.com/OpenCoven/coven-cave/issues/${number}`,
          },
          evidenceRefs: [{
            id: `OpenCoven/coven-cave#${number}`,
            kind: "github",
            label: `Issue ${number}`,
          }],
        },
      ))),
    }),
    { params: Promise.resolve({ id: reverseOrderTarget.id }) },
  );
  assert.equal(reverseOrderGenerated.status, 200);
  const reverseAfterBatch = await board.loadBoard();
  const reverseAfterBatchCard = reverseAfterBatch.cards.find((card) => card.id === reverseOrderTarget.id)!;
  const reverseAfterBatchContext = enhance.buildBoardAgenticContext(reverseAfterBatchCard, reverseAfterBatch.cards);
  const revert48 = await POST(
    request(reverseOrderTarget.id, {
      intent: "board-agentic-enhance",
      action: "revert",
      proposalId: "proposal-reverse-normalize-48",
      contextFingerprint: reverseAfterBatchContext.fingerprint,
    }),
    { params: Promise.resolve({ id: reverseOrderTarget.id }) },
  );
  assert.equal(revert48.status, 200);
  assert.deepEqual(
    (await revert48.json()).card.github.map((link: { url: string }) => link.url),
    [
      "https://github.com/OpenCoven/coven-cave/issues/47",
      "https://github.com/OpenCoven/coven-cave/issues/48/",
    ],
    "reverse-order reversion leaves the first normalization applied",
  );
  const reverseAfter48 = await board.loadBoard();
  const reverseAfter48Card = reverseAfter48.cards.find((card) => card.id === reverseOrderTarget.id)!;
  const reverseAfter48Context = enhance.buildBoardAgenticContext(reverseAfter48Card, reverseAfter48.cards);
  const revert47 = await POST(
    request(reverseOrderTarget.id, {
      intent: "board-agentic-enhance",
      action: "revert",
      proposalId: "proposal-reverse-normalize-47",
      contextFingerprint: reverseAfter48Context.fingerprint,
    }),
    { params: Promise.resolve({ id: reverseOrderTarget.id }) },
  );
  assert.equal(revert47.status, 200);
  assert.deepEqual(
    (await revert47.json()).card.github.map((link: { url: string }) => link.url),
    [
      "https://github.com/OpenCoven/coven-cave/issues/47/",
      "https://github.com/OpenCoven/coven-cave/issues/48/",
    ],
  );

  const raceTarget = await board.createCard({ title: "Atomic proposal target" });
  const raceBoard = await board.loadBoard();
  const raceCurrent = raceBoard.cards.find((card) => card.id === raceTarget.id)!;
  const raceContext = enhance.buildBoardAgenticContext(raceCurrent, raceBoard.cards);
  const raceGenerated = await POST(
    request(raceTarget.id, {
      intent: "board-agentic-enhance",
      action: "generate",
      output: output([recommendation(raceTarget, raceContext.fingerprint, { id: "proposal-race" })]),
    }),
    { params: Promise.resolve({ id: raceTarget.id }) },
  );
  assert.equal(raceGenerated.status, 200);
  const [raceApply, raceDismiss] = await Promise.allSettled([
    board.applyBoardAgenticProposal(
      raceTarget.id,
      "proposal-race",
      { contextFingerprint: raceContext.fingerprint, actor: "reviewer" },
    ),
    board.dismissBoardAgenticProposal(raceTarget.id, "proposal-race", "reviewer"),
  ]);
  assert.equal(raceApply.status, "fulfilled", "the first queued mutation applies atomically");
  assert.equal(raceDismiss.status, "rejected", "the competing dismissal sees the applied state");
  const racePersisted = (await board.loadBoard()).cards.find((card) => card.id === raceTarget.id)!;
  assert.equal(racePersisted.agenticEnhance?.proposals[0]?.state, "applied");
  assert.deepEqual(
    racePersisted.agenticEnhance?.audit.map((entry) => entry.action),
    ["generated", "applied"],
    "no competing audit mutation is written",
  );

  const denseTargets: Array<Awaited<ReturnType<typeof board.createCard>>> = [];
  for (let cardIndex = 0; cardIndex < 64; cardIndex += 1) {
    denseTargets.push(await board.createCard({
      title: `Dense route card ${cardIndex}`,
      dependencies: Array.from({ length: 128 }, (_, dependencyIndex) => ({
        id: `route-dense-${cardIndex}-${dependencyIndex}`,
        kind: "external" as const,
        label: `Resolve route dependency ${dependencyIndex}`,
        state: "unresolved" as const,
        origin: "enhance" as const,
        createdAt: "2026-08-19T14:00:00.000Z",
      })),
    }));
  }
  const denseBoard = await board.loadBoard();
  const denseTarget = denseBoard.cards.find((card) => card.id === denseTargets[0]!.id)!;
  const denseContext = enhance.buildBoardAgenticContext(denseTarget, denseBoard.cards);
  const denseGenerated = await POST(
    request(denseTarget.id, {
      intent: "board-agentic-enhance",
      action: "generate",
      output: output([recommendation(denseTarget, denseContext.fingerprint, { id: "proposal-dense" })]),
    }),
    { params: Promise.resolve({ id: denseTarget.id }) },
  );
  assert.equal(denseGenerated.status, 200, "64 cards with maximal dependency context generate without a fingerprint failure");

  const freshnessTarget = await board.createCard({ title: "Locked proposal freshness" });
  const freshnessBoard = await board.loadBoard();
  const freshnessCurrent = freshnessBoard.cards.find((card) => card.id === freshnessTarget.id)!;
  const freshnessContext = enhance.buildBoardAgenticContext(freshnessCurrent, freshnessBoard.cards);
  const freshnessRecommendation = enhance.validateBoardAgenticRecommendation(
    freshnessCurrent,
    freshnessBoard.cards,
    JSON.parse(output([recommendation(freshnessTarget, freshnessContext.fingerprint, {
      id: "proposal-freshness",
    })])).recommendations[0],
  );
  await board.updateCard(freshnessTarget.id, { notes: "A concurrent editor changed this task." });
  await assert.rejects(
    board.recordBoardAgenticProposal(
      freshnessTarget.id,
      freshnessContext.fingerprint,
      {
        ...enhance.boardAgenticProposalRecord(freshnessContext, freshnessRecommendation),
        actor: "reviewer",
      },
    ),
    (error: unknown) => {
      assert.ok(error instanceof board.BoardAgenticProposalMutationError);
      assert.equal(error.code, "stale_context");
      return true;
    },
  );
  const freshnessPersisted = (await board.loadBoard()).cards.find((card) => card.id === freshnessTarget.id)!;
  assert.deepEqual(freshnessPersisted.agenticEnhance, { proposals: [], audit: [] });

  const fabricatedTarget = await board.createCard({ title: "Reject client proposal fabrication", familiarId: "nyx" });
  const fabricatedBoard = await board.loadBoard();
  const fabricatedCurrent = fabricatedBoard.cards.find((card) => card.id === fabricatedTarget.id)!;
  const fabricatedContext = enhance.buildBoardAgenticContext(fabricatedCurrent, fabricatedBoard.cards);
  const fabricatedGenerator = mockedFamiliarRoute([output([])]);
  const fabricated = await fabricatedGenerator.route(
    request(fabricatedTarget.id, {
      intent: "generate",
      familiarId: "nyx",
      contextFingerprint: fabricatedContext.fingerprint,
      output: output([recommendation(fabricatedCurrent, fabricatedContext.fingerprint, {
        id: "client-forged-proposal",
      })]),
    }),
    { params: Promise.resolve({ id: fabricatedTarget.id }) },
  );
  assert.equal(fabricated.status, 200);
  assert.equal(fabricatedGenerator.calls.length, 1);
  assert.deepEqual((await fabricated.json()).card.agenticEnhance.proposals, []);

  const familiarTarget = await board.createCard({ title: "Persist familiar proposal", familiarId: "nyx" });
  const familiarBoard = await board.loadBoard();
  const familiarCurrent = familiarBoard.cards.find((card) => card.id === familiarTarget.id)!;
  const familiarContext = enhance.buildBoardAgenticContext(familiarCurrent, familiarBoard.cards);
  const familiarGenerator = mockedFamiliarRoute([
    `${JSON.stringify({
      role: "assistant",
      text: output([recommendation(familiarCurrent, familiarContext.fingerprint, { id: "familiar-proposal" })]),
    })}\n${JSON.stringify({ role: "tool", text: "ignore this protocol frame" })}`,
  ]);
  const familiarGenerated = await familiarGenerator.route(
    request(familiarTarget.id, {
      intent: "generate",
      familiarId: "nyx",
      contextFingerprint: familiarContext.fingerprint,
    }),
    { params: Promise.resolve({ id: familiarTarget.id }) },
  );
  assert.equal(familiarGenerated.status, 200);
  assert.equal((await familiarGenerated.json()).card.agenticEnhance.proposals[0].id, "familiar-proposal");
  const familiarPrompt = familiarGenerator.calls[0]?.[0] as string[];
  assert.match(familiarPrompt.at(-1) ?? "", /"recommendations":\[/);
  assert.match(familiarPrompt.at(-1) ?? "", /canonicalize-reference/);
  assert.match(familiarPrompt.at(-1) ?? "", /saved-link/);
  assert.match(familiarPrompt.at(-1) ?? "", /contextFingerprint/);

  const retryTarget = await board.createCard({ title: "Retry malformed familiar output", familiarId: "nyx" });
  const retryBoard = await board.loadBoard();
  const retryCurrent = retryBoard.cards.find((card) => card.id === retryTarget.id)!;
  const retryContext = enhance.buildBoardAgenticContext(retryCurrent, retryBoard.cards);
  const retryGenerator = mockedFamiliarRoute([
    "not recommendation json",
    output([recommendation(retryCurrent, retryContext.fingerprint, { id: "retried-proposal" })]),
  ]);
  const retried = await retryGenerator.route(
    request(retryTarget.id, {
      intent: "generate",
      familiarId: "nyx",
      contextFingerprint: retryContext.fingerprint,
    }),
    { params: Promise.resolve({ id: retryTarget.id }) },
  );
  assert.equal(retried.status, 200);
  assert.equal(retryGenerator.calls.length, 2);
  assert.equal((await retried.json()).card.agenticEnhance.proposals[0].id, "retried-proposal");

  const malformedTarget = await board.createCard({ title: "Reject twice-malformed familiar output", familiarId: "nyx" });
  const malformedBoard = await board.loadBoard();
  const malformedCurrent = malformedBoard.cards.find((card) => card.id === malformedTarget.id)!;
  const malformedContext = enhance.buildBoardAgenticContext(malformedCurrent, malformedBoard.cards);
  const malformedDiagnostics: AgenticDiagnosticEvent[] = [];
  const malformedGenerator = mockedFamiliarRoute(
    [
      JSON.stringify({ recommendations: [{ id: "schema-less" }] }),
      JSON.stringify({ recommendations: [{ id: "still-schema-less" }] }),
    ],
    undefined,
    (event) => malformedDiagnostics.push(event),
  );
  const malformed = await malformedGenerator.route(
    request(malformedTarget.id, {
      intent: "generate",
      familiarId: "nyx",
      contextFingerprint: malformedContext.fingerprint,
    }),
    { params: Promise.resolve({ id: malformedTarget.id }) },
  );
  assert.equal(malformed.status, 502);
  assert.equal((await malformed.json()).error, "malformed_familiar_output");
  assert.equal(malformedGenerator.calls.length, 2);
  assert.deepEqual(
    malformedDiagnostics.map((event) => [event.code, event.status, event.counts?.attempts]),
    [["generation_validation_failed", "rejected", 2]],
  );
  assert.deepEqual(
    (await board.loadBoard()).cards.find((card) => card.id === malformedTarget.id)?.agenticEnhance,
    { proposals: [], audit: [] },
  );

  const staleGenerationTarget = await board.createCard({ title: "Reject stale familiar generation", familiarId: "nyx" });
  const staleGenerationBoard = await board.loadBoard();
  const staleGenerationCurrent = staleGenerationBoard.cards.find((card) => card.id === staleGenerationTarget.id)!;
  const staleGenerationContext = enhance.buildBoardAgenticContext(
    staleGenerationCurrent,
    staleGenerationBoard.cards,
  );
  const staleGenerator = mockedFamiliarRoute(
    [output([recommendation(staleGenerationCurrent, staleGenerationContext.fingerprint, {
      id: "stale-familiar-proposal",
    })])],
    async () => {
      await board.updateCard(staleGenerationTarget.id, { notes: "Changed while the familiar generated." });
    },
  );
  const staleGeneration = await staleGenerator.route(
    request(staleGenerationTarget.id, {
      intent: "generate",
      familiarId: "nyx",
      contextFingerprint: staleGenerationContext.fingerprint,
    }),
    { params: Promise.resolve({ id: staleGenerationTarget.id }) },
  );
  assert.equal(staleGeneration.status, 409);
  assert.deepEqual(
    (await board.loadBoard()).cards.find((card) => card.id === staleGenerationTarget.id)?.agenticEnhance,
    { proposals: [], audit: [] },
  );

  const cancelledTarget = await board.createCard({ title: "Cancel familiar generation", familiarId: "nyx" });
  const cancelledBoard = await board.loadBoard();
  const cancelledCurrent = cancelledBoard.cards.find((card) => card.id === cancelledTarget.id)!;
  const cancelledContext = enhance.buildBoardAgenticContext(cancelledCurrent, cancelledBoard.cards);
  const controller = new AbortController();
  controller.abort();
  const cancelledDiagnostics: AgenticDiagnosticEvent[] = [];
  const cancelledGenerator = mockedFamiliarRoute([], undefined, (event) => cancelledDiagnostics.push(event));
  const cancelled = await cancelledGenerator.route(
    new Request(`http://127.0.0.1/api/board/${cancelledTarget.id}/enhance`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-coven-cave-intent": "board-agentic-enhance",
      },
      body: JSON.stringify({
        intent: "generate",
        familiarId: "nyx",
        contextFingerprint: cancelledContext.fingerprint,
      }),
      signal: controller.signal,
    }),
    { params: Promise.resolve({ id: cancelledTarget.id }) },
  );
  assert.equal(cancelled.status, 499);
  assert.equal(cancelledGenerator.calls.length, 0);
  assert.deepEqual(
    cancelledDiagnostics.map((event) => [event.code, event.status]),
    [["cancelled", "cancelled"]],
  );

  const routeSource = await readFile(new URL("./route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(routeSource, /transitionCard|dispatch/i, "Enhance never dispatches or transitions work");

  console.log("board/[id]/enhance/route.test.ts: ok");
} finally {
  await rm(testHome, { recursive: true, force: true });
}
