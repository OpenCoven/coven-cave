// adapter-conflict-heal: recover from Coven CLI built-in/manifest id clashes.
//
// Cave scaffolds registry adapter manifests into $COVEN_HOME/adapters, and
// every coven spawn points COVEN_HARNESS_ADAPTER_DIRS there. When a CLI
// upgrade later promotes one of those adapters to a *built-in* harness
// (copilot in coven v0.1.2, coven-code before it), released CLIs treat the
// now-shadowed manifest as a FATAL registry error:
//
//   Error: external harness adapter `copilot` in ~/.coven/adapters/copilot.json
//   conflicts with a built-in harness
//
// …which bricks every `coven run` — including harnesses the manifest never
// mentioned. Chat surfaced that as codex turns ending "No assistant text
// returned". The runtime-side fix (skip + warn) is OpenCoven/coven#412; this
// module is Cave's self-heal for the CLIs already in the field: detect the
// conflict in harness stderr, quarantine the stale manifest by renaming it
// off the `.json` extension the CLI scans, and let the caller retry the turn.

import { rename, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

export type BuiltinAdapterConflict = {
  /** Adapter id the CLI reported (e.g. "copilot"). */
  id: string;
  /** Manifest path exactly as the CLI printed it. */
  manifestPath: string;
};

// Matches the released CLI's fatal error line. The id charset mirrors the
// CLI's own `valid_adapter_id` (lowercase alnum plus `.`/`_`/`-`); the path
// is whatever the CLI printed between "in " and " conflicts".
const BUILTIN_CONFLICT_RE =
  /external harness adapter `([a-z0-9._-]+)` in (.+?) conflicts with a built-in harness/;

/** Suffix that quarantines a manifest: the CLI's dir scan only reads `.json`. */
export const SHADOWED_MANIFEST_SUFFIX = ".shadowed-by-builtin";

/**
 * Parse a harness stderr chunk for the fatal built-in conflict error.
 * Returns the first conflict found, or null.
 */
export function detectBuiltinAdapterConflict(
  text: string,
): BuiltinAdapterConflict | null {
  const match = BUILTIN_CONFLICT_RE.exec(text);
  if (!match) return null;
  return { id: match[1], manifestPath: match[2].trim() };
}

/** The adapters directory Cave scaffolds into (honors COVEN_HOME). */
export function covenAdaptersDir(): string {
  const home = process.env.COVEN_HOME?.trim() || path.join(homedir(), ".coven");
  return path.join(home, "adapters");
}

export function shadowedMarkerPath(manifestPath: string): string {
  return `${manifestPath}${SHADOWED_MANIFEST_SUFFIX}`;
}

/**
 * True when a previous heal quarantined this manifest — the scaffold sites
 * check this so a config save can't resurrect a manifest the installed CLI
 * chokes on.
 */
export async function isManifestShadowedByBuiltin(
  manifestPath: string,
): Promise<boolean> {
  try {
    return (await stat(shadowedMarkerPath(manifestPath))).isFile();
  } catch {
    return false;
  }
}

/**
 * Quarantine the conflicting manifest by renaming it to the marker path.
 * Only paths inside the adapters root are touched (prefix-safe containment:
 * `resolved === root || resolved.startsWith(root + path.sep)`), so a crafted
 * or remote error line can't rename arbitrary files. Returns true when the
 * rename happened.
 */
export async function healBuiltinShadowedManifest(
  conflict: BuiltinAdapterConflict,
  adaptersRoot: string = covenAdaptersDir(),
): Promise<boolean> {
  const root = path.resolve(adaptersRoot);
  const resolved = path.resolve(conflict.manifestPath);
  const contained =
    resolved === root || resolved.startsWith(root + path.sep);
  if (!contained || resolved === root) return false;
  if (!resolved.endsWith(".json")) return false;
  try {
    if (!(await stat(resolved)).isFile()) return false;
    await rename(resolved, shadowedMarkerPath(resolved));
    return true;
  } catch {
    return false;
  }
}
