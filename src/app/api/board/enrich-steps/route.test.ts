// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

assert.match(
  source,
  /export async function POST\(req: Request\)/,
  "Enrich route should receive the Request so it can validate intent and observe aborts",
);

assert.match(
  source,
  /req\.headers\.get\("x-coven-cave-intent"\) !== "board-enrich-steps"/,
  "Enrich route should reject requests without the non-simple intent header",
);

assert.match(
  source,
  /type EnrichRequestBody = \{[\s\S]*intent\?: unknown;[\s\S]*familiarId\?: unknown;[\s\S]*\}/,
  "Enrich route should parse both the intent and selected familiar from one JSON body",
);

assert.match(
  source,
  /body\.intent !== ENRICH_INTENT[\s\S]*typeof body\.familiarId !== "string"/,
  "Enrich route should require the matching JSON intent body and familiar id",
);

// The spawn (and its abort wiring) moved to the shared one-shot runner
// (cave-xailn). The guarantee is unchanged, and still checked end to end.
const oneShot = readFileSync(
  new URL("../../../../lib/server/coven-oneshot.ts", import.meta.url),
  "utf8",
);
assert.match(
  oneShot,
  /signal\.addEventListener\("abort", onAbort, \{ once: true \}\)/,
  "Coven child process should be killed if the client aborts",
);
assert.match(
  source,
  /runCovenOneShot\(args, req\.signal, workspace, familiarId\)/,
  "Enrich route forwards its request signal to the runner, so aborts reach the child",
);

assert.match(
  source,
  /if \(req\.signal\.aborted\) break;/,
  "Enrich route should stop iterating cards after abort",
);

assert.match(
  source,
  /await resolveFamiliarWorkspace\(familiarId\)/,
  "Enrich route should run each familiar from its familiar workspace",
);

assert.match(
  source,
  /"--archive"[\s\S]*"--labels"[\s\S]*"board,enrich-steps"/,
  "One-shot enrichment runs should be archived and labeled",
);

assert.match(
  source,
  /type TaskEnrichment = \{[\s\S]*steps\?: string\[\][\s\S]*status\?: CardStatus[\s\S]*lifecycle\?: CardLifecycle[\s\S]*priority\?: CardPriority/,
  "Enrich route should parse a full task metadata payload, not only step strings",
);

assert.match(
  source,
  /type TaskEnrichment = \{[\s\S]*notes\?: string[\s\S]*startDate\?: string \| null[\s\S]*endDate\?: string \| null[\s\S]*links\?: string\[\][\s\S]*github\?: CardGitHubLink\[\][\s\S]*sessionId\?: string \| null/,
  "Enrich route should accept simplified notes, schedule dates, associated links/issues, and linked chat assignment",
);

assert.match(
  source,
  /const STATUS_VALUES = new Set<CardStatus>\(/,
  "Enrich route should validate returned status values against board statuses",
);

assert.match(
  source,
  /const LIFECYCLE_VALUES = new Set<CardLifecycle>\(/,
  "Enrich route should validate returned lifecycle values against board lifecycles",
);

assert.match(
  source,
  /const PRIORITY_VALUES = new Set<CardPriority>\(/,
  "Enrich route should validate returned priority values against board priorities",
);

assert.match(
  source,
  /const candidates = board\.cards\.filter\([\s\S]*c\.familiarId === familiarId[\s\S]*!SKIP_LIFECYCLE\.has\(c\.lifecycle\)[\s\S]*\);/,
  "Enrich route should revisit active assigned tasks only for the selected familiar",
);

assert.doesNotMatch(
  source,
  /const candidates = board\.cards\.filter\([\s\S]*\(c\.steps \?\? \[\]\)\.length === 0[\s\S]*\);/,
  "Enrich route should not skip active tasks only because steps already exist",
);

assert.match(
  source,
  /await updateCard\(card\.id, \{[\s\S]*steps:[\s\S]*status:[\s\S]*lifecycle:[\s\S]*priority:[\s\S]*needsHuman:[\s\S]*lifecycleReason:/,
  "Enrich route should update steps, status, lifecycle, priority, and human/lifecycle metadata together",
);

assert.match(
  source,
  /await updateCard\(card\.id, \{[\s\S]*notes:[\s\S]*startDate:[\s\S]*endDate:[\s\S]*links:[\s\S]*github:[\s\S]*sessionId:/,
  "Enrich route should persist simplified description, dates, associated issue links, and chat assignment together",
);
assert.match(
  source,
  /\}, \{ automated: true \}\)/,
  "Enrich writes must identify themselves as automation for authorship enforcement",
);
assert.match(
  source,
  /error instanceof OrchestrationValidationError[\s\S]*reason: "orchestration_invalid"[\s\S]*errors: error\.errors/,
  "Enrich should report field-specific orchestration rejections per card",
);

assert.match(
  source,
  /async function fetchGitHubIssueStates\(github: CardGitHubLink\[\]\)/,
  "Enrich route should autonomously fetch live GitHub issue/PR state for linked task items",
);

assert.match(
  source,
  /resolveGitHubToken\(\)[\s\S]*https:\/\/api\.github\.com\/repos\/\$\{item\.repo\}\/issues\/\$\{item\.number\}/,
  "GitHub issue-state refresh should use the shared configured GitHub token when present and the REST issue endpoint",
);

assert.match(
  source,
  /function terminalPatchFromGitHub\([\s\S]*state === "closed"[\s\S]*status: "done"[\s\S]*lifecycle: "completed"/,
  "Closed GitHub issues should deterministically complete the linked board task",
);

assert.match(
  source,
  /const githubState = await fetchGitHubIssueStates\(card\.github\)[\s\S]*const normalized = applyGitHubState\(card, normalizeTaskEnrichment/,
  "Live GitHub state should be applied after model enrichment so it can override stale model status",
);

assert.match(
  source,
  /Simplify the description into concise task notes[\s\S]*Create or update subtasks[\s\S]*Set startDate and endDate[\s\S]*Ensure links, github, and sessionId reflect associated issues, PRs, discussions, docs, and chats/,
  "Enrich prompt should explicitly instruct the assigned familiar to clean up subtasks, dates, description, status/priority, and issue/chat links",
);

assert.match(
  source,
  /type TaskEnrichment = \{[\s\S]*dependencies\?: unknown[\s\S]*primaryBlockerId\?: unknown[\s\S]*primaryBlockerPinned\?: unknown[\s\S]*nextStep\?: unknown[\s\S]*confidence\?: unknown/,
  "Enrich route should accept dependency, primary-blocker, next-step, and confidence suggestions from the model",
);

assert.match(
  source,
  /cleanOrchestrationProposal\(enrichment, card, now\)[\s\S]*hasOrchestrationContent\(orchestration\)/,
  "Enrich route should clean and detect dependency/next-step suggestions from the parsed enrichment",
);

assert.match(
  source,
  /assessEnrichmentGates\(card, board\.cards, orchestration, candidate\)[\s\S]*buildEnrichmentProposalRecord\(card, board\.cards, orchestration, gates, now\)/,
  "Enrich route should run the three auto-application gates and build a review-queue record per suggestion",
);

assert.match(
  source,
  /gates\.gatesFailed\.length === 0 \? enrichmentPatch\(orchestration\) : \{\}/,
  "Only a suggestion that passed every gate is folded into the write",
);

assert.match(
  source,
  /agenticEnhance: appendEnrichmentProposal\(/,
  "Gate-rejected and auto-applied suggestions land in the card's agenticEnhance review queue",
);

assert.match(
  source,
  /blockedRecordFromWriteErrors\(card, board\.cards, orchestration, error\.errors, now\)/,
  "Write-level orchestration rejections persist a gate-blocked review proposal (acceptance test 3 parity)",
);

assert.match(
  source,
  /kind: "orchestration"[\s\S]*state: gates\.gatesFailed\.length === 0 \? "auto-applied" : "blocked"/,
  "Enrich route should stream which gates each suggestion passed or failed",
);

assert.match(
  source,
  /Dependencies: propose only what actually blocks this task[\s\S]*Never invent task ids, issue numbers, or services/,
  "Enrich prompt should ground dependency proposals to live tasks, attached GitHub items, and known services",
);

assert.match(
  source,
  /confidence: your self-reported 0\.\.1 confidence\. It only ranks suggestions; it never authorizes a write/,
  "Enrich prompt should rank suggestions by confidence without authorizing writes from it",
);

assert.match(
  source,
  /Set requiresApproval true only when a human decision must gate the action[\s\S]*never dispatched automatically/,
  "Enrich prompt should keep approval-gated next steps human-bound and auto-dispatch-ineligible",
);

assert.match(
  source,
  /Never propose replacing a human-authored dependency or next step; propose a reviewable change instead/,
  "Enrich prompt should respect human authorship of dependency and next-step records",
);

assert.match(
  source,
  /Live board tasks you may reference as task dependencies/,
  "Enrich prompt should hand the familiar the live board task ids it may ground against",
);
