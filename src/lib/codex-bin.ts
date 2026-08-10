// Spawn-safe Codex launcher resolution.
//
// Windows npm installs expose codex.cmd. Node cannot execute batch shims
// directly, and using cmd.exe would re-parse project paths or resume ids as
// shell syntax. Resolve the shim's JavaScript target and invoke Node directly.

import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import {
  covenLaunchCommandForBinary,
  withCovenWrapperWindowPolicy,
  type CovenLaunchCommand,
} from "./coven-bin.ts";

const CODEX_MANAGED_BY_KEYS = [
  "CODEX_MANAGED_BY_NPM",
  "CODEX_MANAGED_BY_PNPM",
  "CODEX_MANAGED_BY_BUN",
] as const;

type CodexPackageManager = "npm" | "pnpm" | "bun";

export type CodexManagedPackage = {
  root: string;
  manager: CodexPackageManager;
};

export type CodexAutomationLaunchCommand = CovenLaunchCommand & {
  managedPackage?: CodexManagedPackage;
};

type PackageManifest = {
  name?: unknown;
  version?: unknown;
  bin?: unknown;
  optionalDependencies?: unknown;
  os?: unknown;
  cpu?: unknown;
};

function readPackageManifest(root: string): PackageManifest | null {
  try {
    const parsed = JSON.parse(readFileSync(
      /* turbopackIgnore: true */ path.join(root, "package.json"),
      "utf8",
    )) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as PackageManifest
      : null;
  } catch {
    return null;
  }
}

function isFile(candidate: string): boolean {
  try {
    const value = statSync(/* turbopackIgnore: true */ candidate);
    return value.isFile() || value.isSymbolicLink();
  } catch {
    return false;
  }
}

function canonicalFileWithin(root: string, candidate: string): string | null {
  try {
    const canonical = realpathSync(/* turbopackIgnore: true */ candidate);
    const relative = path.relative(root, canonical);
    return relative && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative) && isFile(canonical)
      ? canonical
      : null;
  } catch {
    return null;
  }
}

function isPnpmOwnedCodexInstall(
  nodeModulesDir: string,
  canonicalPackageRoot: string,
): boolean {
  if (!existsSync(/* turbopackIgnore: true */ path.join(nodeModulesDir, ".modules.yaml"))) {
    return false;
  }
  try {
    return realpathSync(
      /* turbopackIgnore: true */ path.join(nodeModulesDir, "@openai", "codex"),
    ) === canonicalPackageRoot;
  } catch {
    return false;
  }
}

/** Match the package-manager marker contract set by the official Codex wrapper. */
function codexPackageManager(
  packageRoot: string,
  entrypoint: string,
  env: NodeJS.ProcessEnv,
): CodexPackageManager {
  for (const startDir of new Set([packageRoot, path.dirname(path.resolve(entrypoint))])) {
    const filesystemRoot = path.parse(startDir).root;
    for (
      let currentDir = startDir;
      currentDir !== filesystemRoot;
      currentDir = path.dirname(currentDir)
    ) {
      if (isPnpmOwnedCodexInstall(path.join(currentDir, "node_modules"), packageRoot)) {
        return "pnpm";
      }
    }
    if (isPnpmOwnedCodexInstall(path.join(filesystemRoot, "node_modules"), packageRoot)) {
      return "pnpm";
    }
  }

  const userAgent = env.npm_config_user_agent ?? "";
  const execPath = env.npm_execpath ?? "";
  if (
    /\bbun\//.test(userAgent)
    || execPath.toLowerCase().includes("bun")
    || /[\\/].bun[\\/]install[\\/]global(?:[\\/]|$)/i.test(packageRoot)
  ) {
    return "bun";
  }
  return "npm";
}

function stringRecord(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  return entries.every(([, item]) => typeof item === "string")
    ? Object.fromEntries(entries) as Record<string, string>
    : null;
}

function stringArray(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : null;
}

/**
 * Resolve the native executable behind the official Windows Codex npm shim.
 *
 * The official JS wrapper launches a console-subsystem `codex.exe` without
 * `windowsHide`, so hiding only the Node wrapper can still allocate a visible
 * console. We duplicate its documented package layout and managed-package env
 * contract, but only after proving the root manifest, platform package, CPU,
 * target triple, and executable. Anything else fails closed instead of being
 * interpreted by cmd.exe or executed as an unverified JavaScript launcher.
 */
function officialWindowsCodexNativeLaunch(
  script: string,
  env: NodeJS.ProcessEnv,
  arch: NodeJS.Architecture,
): CodexAutomationLaunchCommand | null {
  const target = arch === "x64"
    ? { packageName: "@openai/codex-win32-x64", triple: "x86_64-pc-windows-msvc", cpu: "x64" }
    : arch === "arm64"
      ? { packageName: "@openai/codex-win32-arm64", triple: "aarch64-pc-windows-msvc", cpu: "arm64" }
      : null;
  if (!target || path.basename(script).toLowerCase() !== "codex.js") return null;

  let packageRoot: string;
  let canonicalScript: string;
  try {
    canonicalScript = realpathSync(/* turbopackIgnore: true */ script);
    packageRoot = realpathSync(/* turbopackIgnore: true */ path.resolve(path.dirname(canonicalScript), ".."));
  } catch {
    return null;
  }
  if (path.basename(path.dirname(canonicalScript)).toLowerCase() !== "bin") return null;

  const rootManifest = readPackageManifest(packageRoot);
  const rootBin = stringRecord(rootManifest?.bin);
  const optionalDependencies = stringRecord(rootManifest?.optionalDependencies);
  if (
    rootManifest?.name !== "@openai/codex"
    || rootBin?.codex?.replaceAll("\\", "/") !== "bin/codex.js"
    || typeof rootManifest.version !== "string"
    || !optionalDependencies?.[target.packageName]
  ) {
    return null;
  }

  const scopedRoot = path.dirname(packageRoot);
  const packageLeaf = target.packageName.slice("@openai/".length);
  const platformRoots = [
    path.join(packageRoot, "node_modules", "@openai", packageLeaf),
    path.join(scopedRoot, packageLeaf),
  ];
  for (const candidateRoot of platformRoots) {
    let platformRoot: string;
    try {
      platformRoot = realpathSync(/* turbopackIgnore: true */ candidateRoot);
    } catch {
      continue;
    }
    const manifest = readPackageManifest(platformRoot);
    const supportedOs = stringArray(manifest?.os);
    const supportedCpu = stringArray(manifest?.cpu);
    if (
      manifest?.name !== "@openai/codex"
      || typeof manifest.version !== "string"
      || manifest.version !== `${rootManifest.version}-win32-${target.cpu}`
      || !supportedOs?.includes("win32")
      || !supportedCpu?.includes(target.cpu)
    ) {
      continue;
    }
    const executable = canonicalFileWithin(
      platformRoot,
      path.join(platformRoot, "vendor", target.triple, "bin", "codex.exe"),
    );
    if (!executable) continue;
    return {
      command: executable,
      fixedArgs: [],
      managedPackage: {
        root: packageRoot,
        manager: codexPackageManager(packageRoot, script, env),
      },
    };
  }

  // Older official packages bundled the target under the root package. Keep
  // that supported fallback as narrow as the wrapper: exact manifest plus
  // exact architecture-specific vendor path.
  const bundledExecutable = canonicalFileWithin(
    packageRoot,
    path.join(packageRoot, "vendor", target.triple, "bin", "codex.exe"),
  );
  if (!bundledExecutable) return null;
  return {
    command: bundledExecutable,
    fixedArgs: [],
    managedPackage: {
      root: packageRoot,
      manager: codexPackageManager(packageRoot, script, env),
    },
  };
}

function candidateDirs(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): string[] {
  const configured = (env.PATH ?? "")
    .split(platform === "win32" ? ";" : path.delimiter)
    .map((directory) => directory.trim().replace(/^"|"$/g, ""));
  if (platform === "win32" && env.APPDATA) {
    configured.push(path.join(env.APPDATA, "npm"));
  }
  return configured
    .filter((directory, index) => !!directory && configured.indexOf(directory) === index)
    .filter((directory) => path.isAbsolute(directory))
    .map((directory) => path.resolve(/* turbopackIgnore: true */ directory))
    .filter((directory) => existsSync(/* turbopackIgnore: true */ directory));
}

export const CODEX_WINDOWS_NOT_FOUND_DIAGNOSTIC =
  "Codex CLI was not found in Cave's launch environment. Install or repair the official @openai/codex package, restart Cave, and try again.";

function verifiedAbsoluteFile(candidate: string): string | null {
  if (!path.isAbsolute(candidate)) return null;
  const absolute = path.resolve(/* turbopackIgnore: true */ candidate);
  try {
    const stat = statSync(/* turbopackIgnore: true */ absolute);
    return stat.isFile() || stat.isSymbolicLink() ? absolute : null;
  } catch {
    return null;
  }
}

/** Windows launch plans never retain a bare or cwd-relative executable name. */
export function verifiedCodexLaunchBinary(
  binary: string,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform !== "win32") return binary;
  const verified = verifiedAbsoluteFile(binary);
  if (!verified) throw new Error(CODEX_WINDOWS_NOT_FOUND_DIAGNOSTIC);
  return verified;
}

export function codexCandidateBinNames(
  platform: NodeJS.Platform = process.platform,
): string[] {
  return platform === "win32"
    ? ["codex.exe", "codex.cmd", "codex.bat", "codex"]
    : ["codex"];
}

/** Resolve a native Codex executable or npm's Windows command shim. */
export function codexBin(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  const override = env.CODEX_BIN;
  if (override) {
    const verified = verifiedAbsoluteFile(override);
    if (verified) return verified;
  }
  for (const directory of candidateDirs(env, platform)) {
    for (const name of codexCandidateBinNames(platform)) {
      const candidate = path.join(/* turbopackIgnore: true */ directory, name);
      const verified = verifiedAbsoluteFile(candidate);
      if (verified) return verified;
    }
  }
  // POSIX PATH lookup does not implicitly search the child's cwd unless the
  // user explicitly put a relative entry in PATH. Windows CreateProcess does:
  // a bare fallback or relative PATH entry would let a Research workspace
  // plant `codex.exe` and have Cave execute it when the real CLI is missing.
  if (platform === "win32") throw new Error(CODEX_WINDOWS_NOT_FOUND_DIAGNOSTIC);
  return "codex";
}

/** A non-shell direct-launch command for Codex on every supported platform. */
export function codexLaunchCommand(
  binary: string = codexBin(),
  platform: NodeJS.Platform = process.platform,
): CovenLaunchCommand {
  return covenLaunchCommandForBinary(binary, platform);
}

/**
 * AutoResearch-specific launcher resolution. On Windows, bypass only the
 * verified official npm wrapper; unrecognized shims remain unlaunchable.
 */
export function codexAutomationLaunchCommand(
  binary: string = codexBin(),
  options: {
    env?: NodeJS.ProcessEnv;
    platform?: NodeJS.Platform;
    arch?: NodeJS.Architecture;
  } = {},
): CodexAutomationLaunchCommand {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const verifiedBinary = verifiedCodexLaunchBinary(binary, platform);
  const launch = codexLaunchCommand(verifiedBinary, platform);
  if (platform !== "win32" || launch.unresolvedWindowsShim) return launch;
  if (/\.(?:exe|com)$/i.test(verifiedBinary)) return launch;
  if (!/\.(?:cmd|bat)$/i.test(verifiedBinary)) {
    return { command: verifiedBinary, fixedArgs: [], unresolvedWindowsShim: true };
  }
  const script = launch.fixedArgs.length === 1 ? launch.fixedArgs[0] : null;
  const native = script
    ? officialWindowsCodexNativeLaunch(script, env, options.arch ?? process.arch)
    : null;
  return native ?? { command: verifiedBinary, fixedArgs: [], unresolvedWindowsShim: true };
}

/** Apply the official wrapper's env contract to a direct native launch. */
export function codexManagedPackageSpawnEnv(
  env: NodeJS.ProcessEnv,
  managedPackage: CodexManagedPackage | undefined,
): NodeJS.ProcessEnv {
  const result = withCovenWrapperWindowPolicy(env, process.platform, false);
  if (!managedPackage) return result;
  result.CODEX_MANAGED_PACKAGE_ROOT = managedPackage.root;
  for (const key of CODEX_MANAGED_BY_KEYS) delete result[key];
  const managerKey = managedPackage.manager === "bun"
    ? "CODEX_MANAGED_BY_BUN"
    : managedPackage.manager === "pnpm"
      ? "CODEX_MANAGED_BY_PNPM"
      : "CODEX_MANAGED_BY_NPM";
  result[managerKey] = "1";
  return result;
}
