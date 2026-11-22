import { lstatSync, readlinkSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { caveHome } from "./coven-paths.ts";

/**
 * Cave's private state for familiar turns: per-turn scope files and MCP
 * configs, which can hold server credentials. It sits in Cave's home, beside
 * the grants file, so a folder that holds it also holds the grants.
 */
export const cavePrivateStatePath = () => path.join(/* turbopackIgnore: true */ caveHome(), "claude-authority");

function isWithin(candidate: string, root: string): boolean {
  const relative = path.relative(/* turbopackIgnore: true */ root, candidate);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

/**
 * The on-disk spelling of a path, through links and case, for its nearest
 * existing ancestor. A missing folder keeps its remaining segments, so
 * `/tmp/x` still compares equal to `/private/tmp/x` before it exists.
 */
export function canonicalPathForOverlap(target: string): string {
  return resolveForOverlap(target)?.resolved ?? path.resolve(/* turbopackIgnore: true */ target);
}

/** More links than any real path passes through; past this it is a loop. */
const MAX_LINK_HOPS = 40;

type OverlapPath = { resolved: string; comparison: string };

/**
 * Walk components in filesystem order: collapsing `..` before following a
 * link changes its destination. Relative link targets start at the canonical
 * parent, including when that parent was reached through another link.
 * Missing suffixes compare without case so an ambiguous spelling cannot gain
 * Write before the authority directory is created. Existing components keep
 * the volume's canonical spelling, including on case-sensitive volumes.
 */
function resolveForOverlap(target: string): OverlapPath | null {
  const absolute = path.isAbsolute(target) ? target : `${process.cwd()}${path.sep}${target}`;
  const split = (value: string) => value.split(process.platform === "win32" ? /[\\/]/ : /\//);
  let current = path.parse(absolute).root;
  let comparison = current;
  let remaining = split(absolute.slice(current.length));
  let missing = false;
  let hops = 0;
  while (remaining.length) {
    const segment = remaining.shift()!;
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      // A future link in an absent prefix could change where `..` leads.
      if (missing) return null;
      current = path.dirname(current);
      comparison = current;
      continue;
    }
    const next = path.join(/* turbopackIgnore: true */ current, segment);
    try {
      const entry = lstatSync(/* turbopackIgnore: true */ next);
      if (entry.isSymbolicLink()) {
        if (++hops > MAX_LINK_HOPS) return null;
        const link = readlinkSync(/* turbopackIgnore: true */ next);
        if (path.isAbsolute(link)) {
          current = path.parse(link).root;
          comparison = current;
          remaining = [...split(link.slice(current.length)), ...remaining];
        } else {
          remaining = [...split(link), ...remaining];
        }
      } else {
        current = realpathSync.native(/* turbopackIgnore: true */ next);
        comparison = current;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") return null;
      missing = true;
      current = next;
      comparison = path.join(/* turbopackIgnore: true */ comparison, segment.toLowerCase());
    }
  }
  return { resolved: current, comparison };
}

/**
 * True when write access to `root` reaches Cave's private state: the folder
 * holds it, or sits inside it. A Claude Build turn is refused on this test, so
 * grants are refused on it too. Folders elsewhere in Cave's home, such as
 * Research Missions, don't overlap. A folder behind links that can't be
 * resolved counts as overlapping: where it leads is unknown.
 */
export function overlapsCavePrivateState(
  root: string,
  privateState: string = canonicalPathForOverlap(cavePrivateStatePath()),
): boolean {
  const candidate = resolveForOverlap(root);
  const authority = resolveForOverlap(privateState);
  const home = resolveForOverlap(caveHome());
  if (!candidate || !authority || !home) return true;
  // Keep the entry protected even if claude-authority links outside Cave home:
  // its parent still contains the grants and other authority-bearing files.
  const authorityEntry = path.join(/* turbopackIgnore: true */ home.comparison, "claude-authority");
  return [authority.comparison, authorityEntry].some((protectedPath) =>
    isWithin(protectedPath, candidate.comparison) || isWithin(candidate.comparison, protectedPath));
}

/** A folder as a person reads it: `~/.coven`, not the full home path. */
export function displayFolder(root: string): string {
  const home = homedir();
  if (!home) return root;
  const relative = path.relative(/* turbopackIgnore: true */ home, root);
  if (relative === "") return "~";
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return root;
  return `~${path.sep}${relative}`;
}

/** How a folder overlaps Cave's private state, for a message that says so. */
export function privateStateRelation(root: string): "contains" | "inside" {
  const candidate = resolveForOverlap(root)?.comparison;
  const authority = resolveForOverlap(cavePrivateStatePath())?.comparison;
  const home = resolveForOverlap(caveHome())?.comparison;
  return candidate && [authority, home && path.join(/* turbopackIgnore: true */ home, "claude-authority")]
    .some((protectedPath) => protectedPath && isWithin(protectedPath, candidate)) ? "contains" : "inside";
}

/** A Write grant that would reach Cave's private state. Read stays allowed. */
export class CavePrivateStateGrantError extends Error {
  readonly status = 409;
  readonly code = "cave_private_state_write";
  readonly project: { id: string; name: string; root: string };

  constructor(project: { id: string; name: string; root: string }, message?: string) {
    const where = privateStateRelation(project.root) === "contains"
      ? "contains Cave’s private state" : "is inside Cave’s private state";
    super(message ?? `${project.name} (${displayFolder(project.root)}) ${where}, so no familiar can have Write access to it. Choose Read instead.`);
    this.name = "CavePrivateStateGrantError";
    this.project = project;
  }
}

/** Why a Claude turn's writable folder overlaps Cave's private state. */
export type PrivateStateOverlap = {
  source: "project" | "workspace" | "chat-folder";
  root: string;
  /** `root` as a person reads it. */
  folder: string;
  relation: "contains" | "inside";
  projectId?: string;
  projectName?: string;
  /** The familiar's own Write grant on the project. */
  direct?: boolean;
  /** Access groups that give the familiar Write on the project. */
  groups?: { id: string; name: string }[];
  message: string;
};

/**
 * The first folder a Full access turn could write that overlaps Cave's private
 * state, and how the familiar came to write there. The chat's own project is
 * checked first: it is the one the person is looking at.
 */
export function findPrivateStateOverlap(input: {
  writableProjects: readonly { id: string; name: string; root: string }[];
  primaryProjectId?: string | null;
  familiarWorkspace?: string;
  primaryRoot: string;
  privateState?: string;
}): Pick<PrivateStateOverlap, "source" | "root" | "projectId" | "projectName"> | null {
  const privateState = input.privateState ?? canonicalPathForOverlap(cavePrivateStatePath());
  const projects = [...input.writableProjects].sort((a, b) =>
    Number(b.id === input.primaryProjectId) - Number(a.id === input.primaryProjectId));
  for (const project of projects) {
    if (overlapsCavePrivateState(project.root, privateState)) {
      return { source: "project", root: project.root, projectId: project.id, projectName: project.name };
    }
  }
  if (input.familiarWorkspace && overlapsCavePrivateState(input.familiarWorkspace, privateState)) {
    return { source: "workspace", root: input.familiarWorkspace };
  }
  if (overlapsCavePrivateState(input.primaryRoot, privateState)) {
    return { source: "chat-folder", root: input.primaryRoot };
  }
  return null;
}

function listWords(words: readonly string[]): string {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
}

/** Who can write to a project: what a folder move onto the private state would hand over. */
export type ProjectWriters = {
  familiarIds: readonly string[];
  groupNames: readonly string[];
  /** Familiars whose accepted Write request hasn't become a grant yet. */
  acceptedFor: readonly string[];
};

/** Why a project's folder can't move onto the private state, and the fix. */
export function privateStateMoveMessage(
  project: { name: string },
  nextRoot: string,
  writers: ProjectWriters,
): string {
  const where = privateStateRelation(nextRoot) === "contains"
    ? "contains Cave’s private state" : "is inside Cave’s private state";
  const who = listWords([
    ...writers.familiarIds,
    ...(writers.groupNames.length
      ? [`the ${listWords(writers.groupNames)} access group${writers.groupNames.length === 1 ? "" : "s"}`] : []),
    ...writers.acceptedFor.map((familiarId) => `an accepted request for ${familiarId}`),
  ]);
  return `${project.name} can’t move to ${displayFolder(nextRoot)}: that folder ${where}, and ${who} can write to ${project.name}. Change that access to Read in Projects first.`;
}

/** The refusal in words: which folder, how the familiar can write there, and the fix. */
export function privateStateOverlapMessage(
  overlap: Omit<PrivateStateOverlap, "message" | "folder" | "relation">,
  familiarName: string,
): string {
  const folder = displayFolder(overlap.root);
  const state = privateStateRelation(overlap.root) === "contains"
    ? "contains Cave’s private state" : "is inside Cave’s private state";
  const refused = "so Cave won’t start a Full access turn";
  const after = "then retry. Read only turns still work.";
  if (overlap.source === "workspace") {
    return `${familiarName}’s workspace (${folder}) ${state}, ${refused}. Give ${familiarName} a workspace folder of its own, ${after}`;
  }
  if (overlap.source === "chat-folder") {
    return `This chat’s folder (${folder}) ${state}, ${refused}. Start the chat in another project, ${after}`;
  }
  const project = overlap.projectName ?? folder;
  const groups = (overlap.groups ?? []).map((group) => group.name);
  const via = [
    ...(overlap.direct ? ["its own grant"] : []),
    ...(groups.length ? [`the ${listWords(groups)} access group${groups.length === 1 ? "" : "s"}`] : []),
  ];
  const fixes = [
    ...(overlap.direct ? [`for ${familiarName}`] : []),
    ...(groups.length ? [`in ${listWords(groups)}`] : []),
  ];
  const how = via.length ? ` through ${listWords(via)}` : "";
  const fix = fixes.length ? ` ${fixes.join(" and ")}` : "";
  return `${familiarName} can write to ${project} (${folder})${how}, and that folder ${state}, ${refused}. In Projects, change ${project} to Read${fix}, ${after}`;
}
