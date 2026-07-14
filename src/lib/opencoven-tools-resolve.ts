import { execFile } from "node:child_process";
import { lstat, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { compareSemver } from "./app-update.ts";
import { pickWindowsLauncher, refreshCovenSpawnEnv } from "./coven-bin.ts";
import {
  discoverOpenCovenTool,
  npmViewLaunchCommandForPath,
  probeOpenCovenBinaryAt,
  OPEN_COVEN_TOOLS,
  type OpenCovenToolId,
  type OpenCovenToolSpec,
} from "./opencoven-tools-status.ts";
import {
  evaluateOpenCovenToolVerification,
  type OpenCovenToolProbe,
  type OpenCovenToolVerification,
} from "./opencoven-tool-verification.ts";

const execFileAsync = promisify(execFile);

/**
 * Stale-launcher remediation for the OpenCoven tool Update/Repair flow.
 *
 * `npm install -g` always writes to npm's global prefix, so when an older
 * copy of the same package sits earlier on PATH (an orphaned nvm tree, an
 * old Homebrew-node prefix, ...), the post-install verification correctly
 * fails with "a stale executable is still first on PATH" — and clicking
 * Update can never succeed. This module makes the flow able to fix that
 * state instead of only reporting it, under strict identity gates:
 *
 *   - The freshly installed copy at npm's global bin must itself verify
 *     (same npm package, version >= the tool minimum and >= npm latest when
 *     known) BEFORE anything is touched. Never delete the only working copy.
 *   - Only launcher FILES whose resolved target belongs to the same npm
 *     package — proven by a verifying package.json bin entry inside a
 *     node_modules tree — are removed. Never directories, never binaries
 *     owned by other packages, never same-named source checkouts or
 *     non-npm builds, never the fresh copy itself.
 *   - When removal is not safe or not permitted, the caller gets an exact,
 *     copyable manual command instead of a silent failure.
 */
export type StaleLauncherResolution = {
  /** True when remediation ran (a failed verification was re-examined). */
  attempted: boolean;
  /** Launcher files removed, in removal order. */
  removed: string[];
  /** Human-readable progress lines for the install job tail. */
  log: string[];
  /** Manual remediation command/path guidance when blocked, else null. */
  hint: string | null;
  /** Final verification after remediation; null when nothing was attempted. */
  verification: OpenCovenToolVerification<OpenCovenToolId> | null;
};

export type StaleLauncherDependencies = {
  platform?: NodeJS.Platform;
  refreshEnv?: () => NodeJS.ProcessEnv;
  /** Resolve npm's global prefix (`npm prefix -g`). */
  npmGlobalPrefix?: (env: NodeJS.ProcessEnv) => Promise<string | null>;
  discover?: (
    tool: OpenCovenToolSpec,
    env: NodeJS.ProcessEnv,
  ) => Promise<OpenCovenToolProbe>;
  probeAt?: (
    tool: OpenCovenToolSpec,
    binaryPath: string,
    env: NodeJS.ProcessEnv,
  ) => Promise<OpenCovenToolProbe>;
  fileExists?: (file: string) => Promise<boolean>;
  removeFile?: (file: string) => Promise<void>;
};

const MAX_REMOVALS = 4;

/** Path semantics must follow the (injectable, testable) target platform,
 *  not the host: launcher paths on win32 are `C:\...` even when the logic
 *  is exercised from a POSIX test host. */
function pathApiFor(platform: NodeJS.Platform): path.PlatformPath {
  return platform === "win32" ? path.win32 : path.posix;
}

function samePath(left: string, right: string, platform: NodeJS.Platform): boolean {
  const api = pathApiFor(platform);
  const normalize = (value: string) =>
    platform === "win32" ? api.normalize(value).toLowerCase() : api.normalize(value);
  return normalize(left) === normalize(right);
}

/** Read npm's global prefix from an already-located npm launcher. Routed
 *  through npmViewLaunchCommandForPath because npm on Windows is a .cmd shim
 *  that Node (>= 21.7 / CVE-2024-27980) refuses to execFile without a shell —
 *  the shim is remapped onto `node npm-cli.js`, keeping the query argv-only. */
export async function npmGlobalPrefixFromNpmPath(
  npmPath: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): Promise<string | null> {
  const launch = npmViewLaunchCommandForPath(npmPath, platform);
  if (!launch) return null;
  try {
    const { stdout } = await execFileAsync(
      launch.command,
      [...launch.fixedArgs, "prefix", "-g"],
      { env, timeout: 5000 },
    );
    const prefix = stdout.trim();
    return prefix || null;
  } catch {
    return null;
  }
}

async function defaultNpmGlobalPrefix(env: NodeJS.ProcessEnv): Promise<string | null> {
  const finder = process.platform === "win32" ? "where" : "which";
  try {
    const { stdout: npmOut } = await execFileAsync(finder, ["npm"], { env, timeout: 1500 });
    const npm =
      process.platform === "win32"
        ? pickWindowsLauncher(npmOut.split(/\r?\n/))
        : npmOut.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? null;
    if (!npm) return null;
    return await npmGlobalPrefixFromNpmPath(npm, env);
  } catch {
    return null;
  }
}

async function defaultFileExists(file: string): Promise<boolean> {
  try {
    const stats = await lstat(file);
    return stats.isFile() || stats.isSymbolicLink();
  } catch {
    return false;
  }
}

/** Launcher-file removal only: refuses directories so a surprising probe
 *  result can never turn into a recursive delete. */
export async function removeLauncherFile(file: string): Promise<void> {
  const stats = await lstat(file);
  if (!stats.isFile() && !stats.isSymbolicLink()) {
    throw new Error(`${file} is not a launcher file`);
  }
  await rm(file, { force: false });
}

/** npm's global bin location: `<prefix>/bin/<binary>` on POSIX; the shims sit
 *  directly in the prefix on Windows. */
function npmGlobalLauncherCandidates(
  prefix: string,
  binary: string,
  platform: NodeJS.Platform,
): string[] {
  const api = pathApiFor(platform);
  if (platform === "win32") {
    return [
      api.join(prefix, `${binary}.cmd`),
      api.join(prefix, `${binary}.ps1`),
      api.join(prefix, binary),
    ];
  }
  return [api.join(prefix, "bin", binary)];
}

/** Sibling Windows shims (`coven`, `coven.cmd`, `coven.ps1`) installed next to
 *  the launcher npm resolved; removing one while its siblings keep shadowing
 *  would leave the tool broken in other shells. */
function launcherSiblings(launcher: string, platform: NodeJS.Platform): string[] {
  if (platform !== "win32") return [launcher];
  const api = pathApiFor(platform);
  const dir = api.dirname(launcher);
  const stem = api.basename(launcher, api.extname(launcher));
  return [api.join(dir, stem), api.join(dir, `${stem}.cmd`), api.join(dir, `${stem}.ps1`)];
}

function manualRemovalHint(paths: string[], platform: NodeJS.Platform): string {
  const command =
    platform === "win32"
      ? paths.map((path) => `del "${path}"`).join(" & ")
      : `rm ${paths.map((path) => `'${path}'`).join(" ")}`;
  return `Remove it manually (${command}), then re-check.`;
}

/** True when `packagePath` is a `node_modules/<packageName>` directory —
 *  the layout every npm-managed global install uses. A source checkout whose
 *  root package.json carries the same name fails this test, which is the
 *  point: deletion demands npm-launcher provenance, not just a name match. */
export function isNodeModulesPackagePath(
  packagePath: string,
  packageName: string,
  platform: NodeJS.Platform,
): boolean {
  const api = pathApiFor(platform);
  const segments = api.normalize(packagePath).split(api.sep).filter(Boolean);
  const expected = ["node_modules", ...packageName.split("/")];
  if (segments.length < expected.length) return false;
  const tail = segments.slice(-expected.length);
  const matches = (left: string, right: string) =>
    platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
  return expected.every((segment, index) => matches(tail[index]!, segment));
}

function staleProbeIsRemovableSamePackage(
  tool: OpenCovenToolSpec,
  probe: OpenCovenToolProbe,
  goodVersion: string,
  platform: NodeJS.Platform,
): boolean {
  if (!probe.path || probe.packageName !== tool.packageName) return false;
  // Deletion demands proven npm-launcher provenance, not just an ancestor
  // package.json with the right name: the manifest's bin entry must resolve
  // to this executable, and the package must live in a node_modules tree.
  // A same-named source checkout or non-npm build on PATH is never removed.
  if (!probe.executableVerified) return false;
  if (!probe.packagePath || !isNodeModulesPackagePath(probe.packagePath, tool.packageName, platform)) {
    return false;
  }
  // Only remove copies that are strictly behind the verified fresh install;
  // an equal-or-newer copy failing verification is a different problem that
  // deletion would not fix.
  if (probe.version && compareSemver(probe.version, goodVersion) >= 0) return false;
  return true;
}

/**
 * After a failed post-install verification, remove stale same-package
 * launchers that shadow the npm global bin on PATH, then re-verify. Returns
 * the final verification so the install flow can report a genuine success
 * (or a genuinely actionable failure) instead of an eternal stale-PATH error.
 */
export async function resolveStaleOpenCovenLaunchers(
  id: OpenCovenToolId,
  latest: string | null,
  dependencies: StaleLauncherDependencies = {},
): Promise<StaleLauncherResolution> {
  const tool = OPEN_COVEN_TOOLS.find((candidate) => candidate.id === id);
  if (!tool) throw new Error("unknown OpenCoven tool");

  const platform = dependencies.platform ?? process.platform;
  const refreshEnv = dependencies.refreshEnv ?? refreshCovenSpawnEnv;
  const npmGlobalPrefix = dependencies.npmGlobalPrefix ?? defaultNpmGlobalPrefix;
  const discover =
    dependencies.discover ??
    ((spec: OpenCovenToolSpec, env: NodeJS.ProcessEnv) =>
      discoverOpenCovenTool(spec, { env }));
  const probeAt = dependencies.probeAt ?? probeOpenCovenBinaryAt;
  const fileExists = dependencies.fileExists ?? defaultFileExists;
  const removeFile = dependencies.removeFile ?? removeLauncherFile;

  const resolution: StaleLauncherResolution = {
    attempted: true,
    removed: [],
    log: [],
    hint: null,
    verification: null,
  };
  const finish = async (env: NodeJS.ProcessEnv): Promise<StaleLauncherResolution> => {
    const probe = await discover(tool, env);
    resolution.verification = evaluateOpenCovenToolVerification(tool, probe, latest);
    return resolution;
  };

  let env = refreshEnv();

  // Gate 0: locate and verify the freshly installed copy at npm's global bin.
  const prefix = await npmGlobalPrefix(env);
  if (!prefix) {
    resolution.log.push(
      "Stale-launcher cleanup skipped: npm's global prefix could not be determined.",
    );
    return finish(env);
  }
  let goodPath: string | null = null;
  for (const candidate of npmGlobalLauncherCandidates(prefix, tool.binary, platform)) {
    if (await fileExists(candidate)) {
      goodPath = candidate;
      break;
    }
  }
  if (!goodPath) {
    resolution.log.push(
      `Stale-launcher cleanup skipped: no ${tool.binary} launcher found under npm's global prefix (${prefix}).`,
    );
    return finish(env);
  }
  const goodProbe = await probeAt(tool, goodPath, env);
  const goodVerification = evaluateOpenCovenToolVerification(tool, goodProbe, latest);
  const goodVersion = goodProbe.version;
  if (
    goodProbe.packageName !== tool.packageName ||
    !goodProbe.executableVerified ||
    !goodVersion ||
    (latest ? compareSemver(goodVersion, latest) < 0 : !goodVerification.compatible)
  ) {
    resolution.log.push(
      `Stale-launcher cleanup skipped: the copy at ${goodPath} did not verify as the freshly installed ${tool.packageName}.`,
    );
    return finish(env);
  }

  for (let pass = 0; pass < MAX_REMOVALS; pass += 1) {
    const probe = await discover(tool, env);
    const verification = evaluateOpenCovenToolVerification(tool, probe, latest);
    resolution.verification = verification;
    if (verification.ok) {
      if (resolution.removed.length > 0) {
        resolution.log.push(
          `${tool.binary} now resolves at ${probe.path} (${probe.version}).`,
        );
      }
      return resolution;
    }
    if (!probe.path || samePath(probe.path, goodPath, platform)) {
      // PATH already reaches the fresh copy (or nothing) and it still fails
      // verification — removal has nothing left to fix.
      return resolution;
    }
    if (!staleProbeIsRemovableSamePackage(tool, probe, goodVersion, platform)) {
      const owner = probe.packageName ?? "an unrecognized launcher";
      resolution.hint =
        `${tool.binary} at ${probe.path} belongs to ${owner}, so Cave will not remove it. ` +
        `Move npm's global bin (${pathApiFor(platform).dirname(goodPath)}) ahead of it on PATH, or remove it yourself and re-check.`;
      return resolution;
    }

    const targets: string[] = [];
    for (const sibling of launcherSiblings(probe.path, platform)) {
      if (samePath(sibling, goodPath, platform)) continue;
      if (await fileExists(sibling)) targets.push(sibling);
    }
    try {
      for (const target of targets) {
        await removeFile(target);
        resolution.removed.push(target);
      }
      resolution.log.push(
        `Removed stale ${tool.binary} launcher at ${probe.path} (${probe.version ?? "version unreadable"}); it shadowed ${goodPath}.`,
      );
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      resolution.log.push(`Could not remove stale ${tool.binary} launcher at ${probe.path}: ${detail}`);
      resolution.hint = manualRemovalHint(
        targets.length > 0 ? targets : [probe.path],
        platform,
      );
      return finish(env);
    }
    env = refreshEnv();
  }
  return finish(env);
}
