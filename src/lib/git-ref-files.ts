import fs from "node:fs";
import path from "node:path";

/**
 * Answers three questions the chat list asks of every project root by reading
 * the repository's own files instead of spawning `git` (#5608): the checked-out
 * branch, the origin URL and the default base ref.
 *
 * Each `git` spawn blocks the event loop while the process is forked (4-8 ms
 * measured under load), and a real profile's cold list spawned 154 of them.
 * Every function here returns `undefined` for "cannot tell from the files" and
 * the caller then asks git exactly as before, so an unusual layout (reftable
 * refs, config includes, per-worktree config) costs a spawn, never a wrong
 * answer. `null` is a definite "none".
 */

function readText(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

/** `branch --show-current`: the branch HEAD names, `null` when detached. */
export function readHeadBranch(gitDir: string | null): string | null | undefined {
  if (!gitDir) return undefined;
  const head = readText(path.join(gitDir, "HEAD"))?.trim();
  if (!head) return undefined;
  const symbolic = /^ref:\s*refs\/heads\/(.+)$/.exec(head);
  if (symbolic) return symbolic[1];
  // A detached HEAD holds an object id; the caller asks git for its short form.
  if (/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(head)) return null;
  return undefined;
}

function unquoteConfigValue(raw: string): string | undefined {
  let value = "";
  let quoted = false;
  for (let i = 0; i < raw.length; i += 1) {
    const char = raw[i];
    if (char === "\\") return undefined; // escapes: leave them to git
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (!quoted && (char === "#" || char === ";")) break;
    value += char;
  }
  return quoted ? undefined : value.trim();
}

/** `config --get remote.origin.url` from the repository's config file. */
export function readOriginUrl(gitDir: string | null, commonDir: string | null): string | null | undefined {
  if (!commonDir) return undefined;
  // Per-worktree config can override the shared file.
  if (gitDir && fs.existsSync(path.join(gitDir, "config.worktree"))) return undefined;
  const config = readText(path.join(commonDir, "config"));
  if (config == null) return undefined;
  let inOrigin = false;
  let url: string | null = null;
  for (const line of config.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[")) {
      // Includes can define the remote anywhere; only git can follow them.
      if (/^\[\s*include(If)?\b/i.test(trimmed)) return undefined;
      const section = /^\[\s*([A-Za-z0-9.-]+)(?:\s+"((?:[^"\\]|\\.)*)")?\s*\]/.exec(trimmed);
      if (!section) return undefined;
      inOrigin = section[1].toLowerCase() === "remote" && section[2] === "origin";
      continue;
    }
    if (!inOrigin) continue;
    const entry = /^([A-Za-z][A-Za-z0-9-]*)\s*=\s*(.*)$/.exec(trimmed);
    if (!entry || entry[1].toLowerCase() !== "url") continue;
    const value = unquoteConfigValue(entry[2]);
    if (value === undefined) return undefined;
    // `git config --get` reports the last value of a multi-valued key.
    url = value || null;
  }
  return url;
}

function refExists(commonDir: string, fullRef: string, packedRefs: string | null): boolean {
  if (fs.existsSync(path.join(commonDir, fullRef))) return true;
  if (!packedRefs) return false;
  return packedRefs.split(/\r?\n/).some((line) => !line.startsWith("#") && !line.startsWith("^") && line.endsWith(` ${fullRef}`));
}

/**
 * The repository's default base ref, as `defaultBaseRef` resolves it: origin's
 * HEAD, then origin/main, origin/master, main, master.
 */
export function readDefaultBaseRef(commonDir: string | null): string | null | undefined {
  if (!commonDir) return undefined;
  if (fs.existsSync(path.join(commonDir, "reftable"))) return undefined;
  if (!fs.existsSync(path.join(commonDir, "refs"))) return undefined;
  const originHead = readText(path.join(commonDir, "refs", "remotes", "origin", "HEAD"))?.trim();
  if (originHead) {
    const target = /^ref:\s*refs\/remotes\/(.+)$/.exec(originHead);
    return target ? target[1] : undefined;
  }
  const packedRefs = readText(path.join(commonDir, "packed-refs"));
  for (const [ref, fullRef] of [
    ["origin/main", "refs/remotes/origin/main"],
    ["origin/master", "refs/remotes/origin/master"],
    ["main", "refs/heads/main"],
    ["master", "refs/heads/master"],
  ] as const) {
    if (refExists(commonDir, fullRef, packedRefs)) return ref;
  }
  // `rev-parse --verify` also resolves tags and other DWIM spellings of these
  // names; a repository with none of the usual refs is rare enough to ask it.
  return undefined;
}
