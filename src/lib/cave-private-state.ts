import { realpathSync } from "node:fs";
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
  let existing = path.resolve(/* turbopackIgnore: true */ target);
  const missing: string[] = [];
  for (;;) {
    try {
      return path.join(/* turbopackIgnore: true */ realpathSync.native(/* turbopackIgnore: true */ existing), ...missing);
    } catch {
      const parent = path.dirname(existing);
      if (parent === existing) return path.resolve(/* turbopackIgnore: true */ target);
      missing.unshift(path.basename(existing));
      existing = parent;
    }
  }
}

/**
 * True when write access to `root` reaches Cave's private state: the folder
 * holds it, or sits inside it. A Claude Build turn is refused on this test, so
 * grants are refused on it too. Folders elsewhere in Cave's home, such as
 * Research Missions, don't overlap.
 */
export function overlapsCavePrivateState(
  root: string,
  privateState: string = canonicalPathForOverlap(cavePrivateStatePath()),
): boolean {
  const candidate = canonicalPathForOverlap(root);
  return isWithin(privateState, candidate) || isWithin(candidate, privateState);
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
  return isWithin(canonicalPathForOverlap(cavePrivateStatePath()), canonicalPathForOverlap(root)) ? "contains" : "inside";
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
