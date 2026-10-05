// Where a pull request from a checkout belongs (#5795).
//
// `gh pr create` with no `--repo` picks a base itself: with no prompt (the
// desk's case), the first remote, sorted upstream, then github, then origin.
// In a plain clone of a fork that's the fork, so the PR opened inside it; with
// an `upstream` remote it's the canonical repository, where a bare `--head
// <branch>` names a branch that was never pushed there, so creation failed
// after the push. The lookup that finds a branch's PR searched origin only.
//
// The desk's branch is always pushed to origin. Its PR belongs to origin's
// parent when origin is a fork, else to origin, and names its head as
// `<origin owner>:<branch>`.

import { execFile } from "node:child_process";
import { scrubSidecarInternalEnv } from "./coven-bin.ts";

export type PrTarget = {
  /** `owner/name` the pull request is opened in. */
  base: string;
  /** Owner of origin, where the branch is pushed. */
  headOwner: string;
  /** The base repository's default branch, when GitHub said. */
  baseDefault: string | null;
  fork: boolean;
};

/** Runs `gh` with these arguments in `cwd` and resolves its stdout. */
export type GhRunner = (cwd: string, args: string[]) => Promise<string>;

const GH_ENV = () => scrubSidecarInternalEnv({ ...process.env, GH_PROMPT_DISABLED: "1" });
const TARGET_TTL_MS = 10 * 60_000;
const targets = new Map<string, { target: PrTarget; at: number }>();

const defaultGh: GhRunner = (cwd, args) =>
  new Promise((resolve, reject) => {
    execFile("gh", args, { windowsHide: true, cwd, timeout: 10_000, env: GH_ENV() }, (err, stdout) =>
      err ? reject(err) : resolve(stdout),
    );
  });

/** `owner/name` of a GitHub remote URL (https or ssh), or null. */
export function githubSlug(url: string): string | null {
  const match = /github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?\/?\s*$/.exec(url.trim());
  return match ? match[1]! : null;
}

function originUrl(root: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile("git", ["-C", root, "remote", "get-url", "origin"], { windowsHide: true, timeout: 10_000, env: GH_ENV() }, (err, stdout) =>
      resolve(err ? null : stdout.trim()),
    );
  });
}

/** The target from GitHub's `GET /repos/:owner/:repo` answer for origin. */
export function targetFromRepo(slug: string, repo: unknown): PrTarget {
  const owner = slug.split("/")[0]!;
  const r = (repo ?? {}) as {
    fork?: unknown;
    full_name?: unknown;
    default_branch?: unknown;
    parent?: { full_name?: unknown; default_branch?: unknown } | null;
  };
  if (r.fork === true && typeof r.parent?.full_name === "string") {
    return {
      base: r.parent.full_name,
      headOwner: owner,
      baseDefault: typeof r.parent.default_branch === "string" ? r.parent.default_branch : null,
      fork: true,
    };
  }
  return {
    base: typeof r.full_name === "string" ? r.full_name : slug,
    headOwner: owner,
    baseDefault: typeof r.default_branch === "string" ? r.default_branch : null,
    fork: false,
  };
}

/** Where `root`'s pull requests belong, or null when origin isn't on GitHub.
 *  When GitHub can't be asked, origin itself: still named, so `gh` never
 *  picks a remote on its own. */
export async function resolvePrTarget(root: string, gh: GhRunner = defaultGh): Promise<PrTarget | null> {
  const url = await originUrl(root);
  const slug = url ? githubSlug(url) : null;
  if (!slug) return null;
  const hit = targets.get(slug);
  if (hit && Date.now() - hit.at < TARGET_TTL_MS) return hit.target;
  try {
    const target = targetFromRepo(slug, JSON.parse(await gh(root, ["api", `repos/${slug}`])));
    targets.set(slug, { target, at: Date.now() });
    return target;
  } catch {
    return { base: slug, headOwner: slug.split("/")[0]!, baseDefault: null, fork: false };
  }
}

/** `gh pr create` arguments: in the target repository, from origin's branch. */
export function prCreateArgs(
  target: PrTarget | null,
  pr: { base: string; branch: string; title: string; body: string },
): string[] {
  const base = target?.fork && target.baseDefault ? target.baseDefault : pr.base;
  const head = target?.fork ? `${target.headOwner}:${pr.branch}` : pr.branch;
  return ["pr", "create", ...(target ? ["--repo", target.base] : []), "--base", base, "--head", head, "--title", pr.title, "--body", pr.body];
}

/** REST lookup of a branch's pull request, in the repository it was opened in. */
export function prLookupArgs(target: PrTarget, branch: string): string[] {
  return ["api", "-X", "GET", `repos/${target.base}/pulls`, "-f", `head=${target.headOwner}:${branch}`, "-f", "state=all", "-f", "per_page=1"];
}
