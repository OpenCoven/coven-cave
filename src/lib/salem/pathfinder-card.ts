// Deterministic pathfinder card assembly + defensive sanitizer. buildCard turns
// a matched registry path into the SalemPathfinderCard contract; sanitizeCard
// hardens any card (v0 deterministic or a future v1 model card) before render —
// dropping unknown action kinds, unsafe commands, and non-http links.

import { getPath, type HappyPath } from "./happy-paths.ts";
import type {
  SalemActionKind,
  SalemPathfinderAction,
  SalemPathfinderCard,
  SalemPathfinderRequest,
  SalemPathfinderResult,
} from "./pathfinder-types.ts";

const ACTION_KINDS = new Set<SalemActionKind>([
  "cave-route",
  "copy-command",
  "run-doctor",
  "save-board-checklist",
  "external-link",
]);

// Commands may only be a single safe invocation of a known tool with no shell
// metacharacters. Defends the rendered copy-button against injected commands.
const SAFE_BINS = new Set(["npm", "npx", "pnpm", "yarn", "coven", "git"]);

export function isSafeCommand(cmd?: string): boolean {
  if (!cmd || typeof cmd !== "string") return false;
  if (/[;&|`$<>\n]|\$\(/.test(cmd)) return false;
  const bin = cmd.trim().split(/\s+/)[0];
  return SAFE_BINS.has(bin);
}

function isHttpLink(url: string): boolean {
  return typeof url === "string" && /^https?:\/\//.test(url);
}

function primaryActionFor(path: HappyPath): SalemPathfinderAction {
  const stepAction = path.steps.find((s) => s.caveAction)?.caveAction;
  if (stepAction && ACTION_KINDS.has(stepAction.kind)) return { ...stepAction };
  const t = path.primaryTarget;
  if (t.kind === "external-link" && t.url) return { kind: "external-link", label: `Open ${t.name}`, target: t.url };
  if (t.kind === "repo" && t.url) return { kind: "external-link", label: `Open ${t.name}`, target: t.url };
  if (t.kind === "cave-route" && t.route) return { kind: "cave-route", label: `Open ${t.name}`, target: t.route };
  const cmdStep = path.steps.find((s) => s.command);
  if (cmdStep?.command) return { kind: "copy-command", label: "Copy first command", target: cmdStep.command };
  return { kind: "cave-route", label: "Open Cave home", target: "/" };
}

function whyLine(req: SalemPathfinderRequest, result: SalemPathfinderResult, path: HappyPath): string {
  if (result.confidence === "low") {
    return `This is the closest path to what you described. ${path.summary}`;
  }
  return `Based on "${(req.userMessage ?? "").trim().slice(0, 120)}", this path gets you to: ${path.successMoment}`;
}

export function buildCard(req: SalemPathfinderRequest, result: SalemPathfinderResult): SalemPathfinderCard {
  const path = getPath(result.pathId) ?? getPath("first-familiar-cave")!;

  const steps = path.steps.map((s) => ({
    id: s.id,
    title: s.title,
    body: s.body,
    command: s.command,
    status: "ready" as const,
  }));

  const secondary: SalemPathfinderAction[] = [];
  // Home (full) cards can save the path to the Board; setup (slim) cards cannot.
  if (req.mode === "home") {
    secondary.push({ kind: "save-board-checklist", label: "Save to Board" });
  }
  const docs = path.links[0];
  if (docs && isHttpLink(docs.url)) {
    secondary.push({ kind: "external-link", label: docs.label, target: docs.url });
  }

  const card: SalemPathfinderCard = {
    schemaVersion: "salem.pathfinder.v1",
    mode: req.mode,
    recommendedPathId: path.id,
    confidence: result.confidence,
    title: path.title,
    summary: path.summary,
    why: whyLine(req, result, path),
    assumptions: result.assumptions,
    steps,
    links: path.links.filter((l) => isHttpLink(l.url)),
    blockers: path.blockers,
    primaryAction: primaryActionFor(path),
    secondaryActions: secondary,
    transcriptSummary: `${path.title} — ${path.successMoment}`,
  };

  return sanitizeCard(card);
}

/** Harden a card before render. Idempotent; safe on deterministic or model cards. */
export function sanitizeCard(card: SalemPathfinderCard): SalemPathfinderCard {
  const steps = (card.steps ?? []).map((s) => ({
    ...s,
    command: isSafeCommand(s.command) ? s.command : undefined,
  }));
  const links = (card.links ?? []).filter((l) => l && isHttpLink(l.url));
  const secondaryActions = (card.secondaryActions ?? []).filter((a) => a && ACTION_KINDS.has(a.kind));
  let primaryAction = card.primaryAction;
  if (!primaryAction || !ACTION_KINDS.has(primaryAction.kind)) {
    const firstLink = links[0];
    primaryAction = firstLink
      ? { kind: "external-link", label: firstLink.label, target: firstLink.url }
      : { kind: "cave-route", label: "Open Cave home", target: "/" };
  }
  return { ...card, schemaVersion: "salem.pathfinder.v1", steps, links, primaryAction, secondaryActions };
}
