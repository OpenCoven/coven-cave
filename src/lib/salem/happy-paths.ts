// Salem happy-path registry — typed loader.
//
// `happy-paths.json` is the source of truth; this module validates it against
// the required-key contract (mirrors happy-paths.schema.json) at import time
// and exports typed accessors for Salem's matcher, the pathfinder route, the
// rendered card, and tests. v0 keeps the registry in Cave (design §"Registry
// Design"); it can move to coven-docs once another surface needs it.

import registry from "./happy-paths.json" with { type: "json" };

export type HappyPathSurface = "setup" | "home" | "both";
export type HappyPathMaturity = "experimental" | "beta" | "stable-ish";
export type HappyPathTargetKind = "cave-route" | "repo" | "product" | "external-link";
export type HappyPathActionKind =
  | "cave-route"
  | "copy-command"
  | "run-doctor"
  | "save-board-checklist"
  | "external-link";

export type HappyPathAction = {
  kind: HappyPathActionKind;
  label: string;
  target?: string;
};

export type HappyPathStep = {
  id: string;
  title: string;
  body: string;
  command?: string;
  caveAction?: HappyPathAction;
};

export type HappyPathLink = { label: string; url: string };
export type HappyPathBlocker = { label: string; suggestion: string };

export type HappyPathTarget = {
  kind: HappyPathTargetKind;
  name: string;
  route?: string;
  repo?: string;
  url?: string;
};

export type HappyPath = {
  id: string;
  title: string;
  audiences: string[];
  intents: string[];
  surface: HappyPathSurface;
  primaryTarget: HappyPathTarget;
  summary: string;
  prerequisites: string[];
  steps: HappyPathStep[];
  successMoment: string;
  blockers: HappyPathBlocker[];
  links: HappyPathLink[];
  maturity: HappyPathMaturity;
};

export type HappyPathRegistry = { version: string; paths: HappyPath[] };

const SURFACES = new Set<string>(["setup", "home", "both"]);
const MATURITIES = new Set<string>(["experimental", "beta", "stable-ish"]);
const TARGET_KINDS = new Set<string>(["cave-route", "repo", "product", "external-link"]);
const ACTION_KINDS = new Set<string>([
  "cave-route",
  "copy-command",
  "run-doctor",
  "save-board-checklist",
  "external-link",
]);

/**
 * Validate a registry object against the required-key contract. Throws on the
 * first violation. Pure (no IO) so it can guard both the bundled JSON at import
 * time and arbitrary input in tests.
 */
export function validateRegistry(input: unknown): asserts input is HappyPathRegistry {
  const reg = input as HappyPathRegistry;
  if (!reg || typeof reg.version !== "string" || !Array.isArray(reg.paths) || reg.paths.length < 1) {
    throw new Error("happy-paths: registry must have a version and at least one path");
  }
  for (const p of reg.paths) {
    const req: Array<keyof HappyPath> = [
      "id", "title", "audiences", "intents", "surface", "primaryTarget",
      "summary", "prerequisites", "steps", "successMoment", "blockers", "links", "maturity",
    ];
    for (const k of req) {
      if (p[k] === undefined || p[k] === null) {
        throw new Error(`happy-paths: path ${p?.id ?? "<unknown>"} missing required key "${String(k)}"`);
      }
    }
    if (!SURFACES.has(p.surface)) throw new Error(`happy-paths: ${p.id} has invalid surface`);
    if (!MATURITIES.has(p.maturity)) throw new Error(`happy-paths: ${p.id} has invalid maturity`);
    if (!p.primaryTarget || !TARGET_KINDS.has(p.primaryTarget.kind) || !p.primaryTarget.name) {
      throw new Error(`happy-paths: ${p.id} has invalid primaryTarget`);
    }
    if (!Array.isArray(p.steps) || p.steps.length < 1) throw new Error(`happy-paths: ${p.id} needs ≥1 step`);
    for (const s of p.steps) {
      if (!s.id || !s.title || !s.body) throw new Error(`happy-paths: ${p.id} has a malformed step`);
      if (s.caveAction && !ACTION_KINDS.has(s.caveAction.kind)) {
        throw new Error(`happy-paths: ${p.id} step ${s.id} has invalid action kind`);
      }
    }
  }
}

validateRegistry(registry);

export const REGISTRY_VERSION: string = (registry as HappyPathRegistry).version;
export const HAPPY_PATHS: HappyPath[] = (registry as HappyPathRegistry).paths;

const BY_ID = new Map(HAPPY_PATHS.map((p) => [p.id, p]));

export function getPath(id: string): HappyPath | undefined {
  return BY_ID.get(id);
}
