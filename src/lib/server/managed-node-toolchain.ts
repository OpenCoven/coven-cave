import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  MANAGED_NODE_VERSION,
  nodeArchiveFor,
  type PrerequisiteArchitecture,
  type PrerequisitePlatform,
} from "../onboarding-prerequisites.ts";
import { extractSafeTarGz, extractSafeZip } from "./managed-node-archive.ts";
import { probeOwnedDirectoryWrite } from "./owned-directory-write.ts";

const execFileAsync = promisify(execFile);
const INSTALL_TIMEOUT_MS = 5 * 60_000;
const NODE_PROBE_TIMEOUT_MS = 1_500;
const NPM_PROBE_TIMEOUT_MS = 15_000;

export type ManagedNodePaths = {
  platform: ManagedNodePlatform;
  root: string;
  stagingRoot: string;
  installDir: string;
  node: string;
  npmCli: string;
  npmPrefix: string;
  npmBin: string;
};

export type ManagedNodeInstallFailure =
  | "application_data_not_writable"
  | "filesystem_failed"
  | "download_failed"
  | "integrity_check_failed"
  | "archive_failed"
  | "install_timeout"
  | "verification_failed"
  | "unsupported_platform"
  | "unknown_failure";

export type ManagedToolchainWriteProbe = {
  exists: boolean | null;
  writeProbe: "passed" | "failed";
};

type ManagedNodePlatform = "win32" | "darwin" | "linux";

export type ManagedNodeProbe =
  | {
      status: "ready";
      version: string;
      paths: ManagedNodePaths;
    }
  | { status: "missing"; paths: ManagedNodePaths }
  | { status: "incompatible"; version: string; paths: ManagedNodePaths }
  | {
      status: "unusable";
      detail: string;
      paths: ManagedNodePaths;
      failure?: ManagedNodeInstallFailure;
      applicationData?: ManagedToolchainWriteProbe;
    };

type ManagedNodeReadyProbe = Extract<ManagedNodeProbe, { status: "ready" }>;

export type ManagedNodeInstallResult =
  | {
      ok: true;
      outcome: "already_ready" | "installed";
      probe: ManagedNodeReadyProbe;
    }
  | {
      ok: false;
      failure: ManagedNodeInstallFailure;
      detail: string;
      paths: ManagedNodePaths;
      applicationData?: ManagedToolchainWriteProbe;
    };

function cancelledManagedNodeInstall(paths: ManagedNodePaths): ManagedNodeInstallResult {
  return {
    ok: false,
    failure: "unknown_failure",
    detail: "Managed Node installation was cancelled.",
    paths,
  };
}

function throwIfManagedNodeInstallCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("Managed Node installation was cancelled.");
}

type ManagedNodeInstallPhase =
  | "filesystem"
  | "download"
  | "integrity"
  | "archive"
  | "verification";

type ManagedNodeProbeExec = (
  file: string,
  args: readonly string[],
  options: { env: NodeJS.ProcessEnv; timeout: number },
) => Promise<{ stdout: string; stderr: string }>;

function isProbeTimeout(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const processError = error as { code?: unknown; killed?: unknown };
  return processError.killed === true || processError.code === "ETIMEDOUT";
}

async function runManagedNodeProbe(
  run: ManagedNodeProbeExec,
  label: "Node.js" | "npm",
  file: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  timeout: number,
): Promise<{ stdout: string; stderr: string }> {
  try {
    return await run(file, args, { env, timeout });
  } catch (error) {
    if (!isProbeTimeout(error)) throw error;
    throw new Error(
      `Managed ${label} probe timed out after ${timeout}ms. Retry setup; on Windows, antivirus scanning may delay the first launch.`,
    );
  }
}

function supportedPlatform(platform: NodeJS.Platform): platform is ManagedNodePlatform {
  return platform === "win32" || platform === "darwin" || platform === "linux";
}

function supportedArchitecture(architecture: string): architecture is PrerequisiteArchitecture {
  return architecture === "x64" || architecture === "arm64";
}

function pathApi(platform: PrerequisitePlatform): typeof path {
  return platform === "win32" ? path.win32 : path.posix;
}

export function managedNodeRoot(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  home = homedir(),
): string {
  const paths = platform === "win32" ? path.win32 : path.posix;
  if (platform === "win32") {
    return paths.join(env.LOCALAPPDATA || paths.join(home, "AppData", "Local"), "OpenCoven", "CovenCave", "toolchains");
  }
  if (platform === "darwin") return paths.join(home, "Library", "Application Support", "OpenCoven", "CovenCave", "toolchains");
  return paths.join(env.XDG_DATA_HOME || paths.join(home, ".local", "share"), "opencoven", "coven-cave", "toolchains");
}

export function managedNodePaths(
  platform: NodeJS.Platform = process.platform,
  architecture: string = process.arch,
  env: NodeJS.ProcessEnv = process.env,
  home = homedir(),
): ManagedNodePaths | null {
  if (!supportedPlatform(platform) || !supportedArchitecture(architecture)) return null;
  const pathOps = pathApi(platform);
  const root = managedNodeRoot(platform, env, home);
  const installDir = pathOps.join(root, "node", `v${MANAGED_NODE_VERSION}`, `${platform}-${architecture}`);
  const npmPrefix = pathOps.join(root, "npm");
  // Node's official Windows zip has node.exe and node_modules at its root;
  // POSIX archives use bin/ and lib/. Keep this explicit instead of trying to
  // execute npm.cmd (which would reintroduce a batch shell dependency).
  const node = platform === "win32"
    ? pathOps.join(installDir, "node.exe")
    : pathOps.join(installDir, "bin", "node");
  const npmCli = platform === "win32"
    ? pathOps.join(installDir, "node_modules", "npm", "bin", "npm-cli.js")
    : pathOps.join(installDir, "lib", "node_modules", "npm", "bin", "npm-cli.js");
  return {
    platform,
    root,
    stagingRoot: pathOps.join(root, "staging"),
    installDir,
    node,
    npmCli,
    npmPrefix,
    npmBin: platform === "win32" ? npmPrefix : pathOps.join(npmPrefix, "bin"),
  };
}

export function managedNodeSpawnEnv(
  base: NodeJS.ProcessEnv,
  paths = managedNodePaths(),
): NodeJS.ProcessEnv | null {
  if (!paths) return null;
  const pathOps = pathApi(paths.platform);
  const nodeBin = pathOps.dirname(paths.node);
  const parts = [paths.npmBin, nodeBin, base.PATH].filter(Boolean);
  return {
    ...base,
    PATH: parts.join(paths.platform === "win32" ? ";" : ":"),
    NPM_CONFIG_PREFIX: paths.npmPrefix,
    npm_config_prefix: paths.npmPrefix,
  };
}

export function managedNpmLaunch(paths = managedNodePaths()): { command: string; args: string[] } | null {
  if (!paths || !existsSync(/* turbopackIgnore: true */ paths.node) || !existsSync(/* turbopackIgnore: true */ paths.npmCli)) return null;
  return { command: paths.node, args: [paths.npmCli] };
}

export async function probeManagedNodeToolchain(
  options: {
    platform?: NodeJS.Platform;
    architecture?: string;
    env?: NodeJS.ProcessEnv;
    home?: string;
    exec?: ManagedNodeProbeExec;
  } = {},
): Promise<ManagedNodeProbe> {
  const paths = managedNodePaths(options.platform, options.architecture, options.env, options.home);
  if (!paths || !existsSync(/* turbopackIgnore: true */ paths.node) || !existsSync(/* turbopackIgnore: true */ paths.npmCli)) return { status: "missing", paths: paths ?? unmanagedPaths() };
  const env = managedNodeSpawnEnv(options.env ?? process.env, paths);
  if (!env) return { status: "missing", paths };
  const run = options.exec ?? execFileAsync;
  try {
    const [{ stdout }, npm] = await Promise.all([
      runManagedNodeProbe(run, "Node.js", paths.node, ["--version"], env, NODE_PROBE_TIMEOUT_MS),
      runManagedNodeProbe(run, "npm", paths.node, [paths.npmCli, "--version"], env, NPM_PROBE_TIMEOUT_MS),
    ]);
    if (!npm.stdout.trim()) return { status: "unusable", detail: "npm did not report a version", paths };
    const version = stdout.trim().replace(/^v/, "");
    if (!version.startsWith(`${MANAGED_NODE_VERSION.split(".").slice(0, 2).join(".")}.`)) {
      return { status: "incompatible", version, paths };
    }
    return { status: "ready", version, paths };
  } catch (error) {
    return { status: "unusable", detail: error instanceof Error ? error.message : "Node/npm could not start", paths };
  }
}

function unmanagedPaths(): ManagedNodePaths {
  // An unsupported architecture is never installable. This inert shape lets
  // callers retain the same diagnostic contract without using a system path.
  const root = managedNodeRoot();
  return {
    platform: process.platform === "win32" ? "win32" : process.platform === "darwin" ? "darwin" : "linux",
    root,
    stagingRoot: path.join(/* turbopackIgnore: true */ root, "staging"),
    installDir: path.join(/* turbopackIgnore: true */ root, "unsupported"),
    node: path.join(/* turbopackIgnore: true */ root, "unsupported", "node"),
    npmCli: path.join(/* turbopackIgnore: true */ root, "unsupported", "npm-cli.js"),
    npmPrefix: path.join(/* turbopackIgnore: true */ root, "npm"),
    npmBin: path.join(/* turbopackIgnore: true */ root, "npm", "bin"),
  };
}

function isOfficialNodeArtifact(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === "nodejs.org" && parsed.pathname.startsWith(`/dist/v${MANAGED_NODE_VERSION}/node-v${MANAGED_NODE_VERSION}-`);
  } catch {
    return false;
  }
}

async function responseBuffer(response: Response, maxBytes: number, signal?: AbortSignal): Promise<Buffer> {
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > maxBytes) throw new Error("Node archive exceeds the approved size limit");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Node archive response has no body");
  const chunks: Uint8Array[] = [];
  let total = 0;
  let rejectOnAbort: ((reason?: unknown) => void) | null = null;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectOnAbort = reject;
  });
  const onAbort = () => {
    void reader.cancel().catch(() => undefined);
    rejectOnAbort?.(new Error("install cancelled"));
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    if (signal?.aborted) onAbort();
    while (true) {
      const { done, value } = await Promise.race([reader.read(), aborted]);
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error("Node archive exceeds the approved size limit");
      }
      chunks.push(value);
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total);
}

async function onlyRuntimeDirectory(root: string): Promise<string> {
  const entries = await readdir(/* turbopackIgnore: true */ root, { withFileTypes: true });
  const directories = entries.filter((entry) => entry.isDirectory() && /^node-v\d+\.\d+\.\d+-/.test(entry.name));
  if (directories.length !== 1 || entries.some((entry) => !entry.isDirectory())) {
    throw new Error("managed Node archive did not contain one runtime directory");
  }
  return path.join(/* turbopackIgnore: true */ root, directories[0]!.name);
}

export function classifyManagedNodeInstallError(
  error: unknown,
): Exclude<
  ManagedNodeInstallFailure,
  "application_data_not_writable" | "verification_failed" | "unsupported_platform"
> {
  const errorCode =
    error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code ?? "")
      : "";
  const message = error instanceof Error ? error.message : String(error);
  if (
    /^(EACCES|EPERM|EROFS|ENOSPC)$/i.test(errorCode) ||
    /(EACCES|EPERM|EROFS|ENOSPC|permission denied|read-only|mkdir|rename|writeFile)/i.test(message)
  ) {
    return "filesystem_failed";
  }
  if (/timed? out|timeout/i.test(message)) return "install_timeout";
  if (/digest|integrity|checksum/i.test(message)) {
    return "integrity_check_failed";
  }
  if (
    /archive|extract|runtime directory|entry type|link target|symbolic link/i.test(
      message,
    )
  ) {
    return "archive_failed";
  }
  if (
    /fetch|download|request|response|redirect|network|approved size limit/i.test(
      message,
    )
  ) {
    return "download_failed";
  }
  return "unknown_failure";
}

function failureForInstallPhase(
  phase: ManagedNodeInstallPhase,
  error: unknown,
): Exclude<ManagedNodeInstallFailure, "application_data_not_writable"> {
  if (classifyManagedNodeInstallError(error) === "filesystem_failed") {
    return "filesystem_failed";
  }
  if (phase === "download") return "download_failed";
  if (phase === "integrity") return "integrity_check_failed";
  if (phase === "archive") return "archive_failed";
  if (phase === "verification") return "verification_failed";
  const classified = classifyManagedNodeInstallError(error);
  return classified === "filesystem_failed" ? classified : "unknown_failure";
}

/**
 * Test the exact Cave-owned toolchain root with a disposable file. A directory
 * stat alone can succeed on a read-only mount, so it is not evidence that the
 * installer can write there.
 */
export async function probeManagedToolchainWriteAccess(
  paths: ManagedNodePaths,
): Promise<ManagedToolchainWriteProbe> {
  return probeOwnedDirectoryWrite(paths.root);
}

export async function installManagedNodeToolchain(options: {
  platform?: NodeJS.Platform;
  architecture?: string;
  env?: NodeJS.ProcessEnv;
  home?: string;
  fetch?: typeof fetch;
  signal?: AbortSignal;
  onProgress?: (line: string) => void;
  dependencies?: {
    probe?: typeof probeManagedNodeToolchain;
    digest?: (archive: Buffer) => string;
    downloadTimeoutMs?: number;
    writeProbe?: typeof probeOwnedDirectoryWrite;
    extractArchive?: (
      format: "zip" | "tar.gz",
      archive: Buffer,
      destination: string,
    ) => Promise<void>;
    remove?: typeof rm;
    rename?: typeof rename;
    runtimeDirectory?: typeof onlyRuntimeDirectory;
  };
} = {}): Promise<ManagedNodeInstallResult> {
  const platform = options.platform ?? process.platform;
  const architecture = options.architecture ?? process.arch;
  const paths = managedNodePaths(platform, architecture, options.env, options.home);
  if (!paths || !supportedPlatform(platform) || !supportedArchitecture(architecture)) {
    return {
      ok: false,
      detail: "This platform or architecture has no approved managed Node archive.",
      paths: paths ?? unmanagedPaths(),
      failure: "unsupported_platform",
    };
  }
  if (options.signal?.aborted) return cancelledManagedNodeInstall(paths);
  const probe = options.dependencies?.probe ?? probeManagedNodeToolchain;
  const existing = await probe({ platform, architecture, env: options.env, home: options.home });
  // The readiness probe is bounded, but it does not accept an AbortSignal.
  // Honor cancellation before any installer directory or network work begins.
  if (options.signal?.aborted) return cancelledManagedNodeInstall(paths);
  if (existing.status === "ready") {
    return { ok: true, outcome: "already_ready", probe: existing };
  }
  const artifact = nodeArchiveFor(platform, architecture);
  if (!artifact || !isOfficialNodeArtifact(artifact.url)) {
    return {
      ok: false,
      detail: "No approved Node artifact is available for this platform.",
      paths,
      failure: "unsupported_platform",
    };
  }
  const fetcher = options.fetch ?? fetch;
  const remove = options.dependencies?.remove ?? rm;
  const move = options.dependencies?.rename ?? rename;
  const runtimeDirectory = options.dependencies?.runtimeDirectory ?? onlyRuntimeDirectory;
  const stage = path.join(/* turbopackIgnore: true */ paths.stagingRoot, `node-${randomUUID()}`);
  const installTemporary = `${paths.installDir}.tmp-${randomUUID()}`;
  let downloadTimedOut = false;
  let phase: ManagedNodeInstallPhase = "filesystem";
  let writeProbeTarget = paths.stagingRoot;
  try {
    throwIfManagedNodeInstallCancelled(options.signal);
    await mkdir(/* turbopackIgnore: true */ stage, { recursive: true });
    throwIfManagedNodeInstallCancelled(options.signal);
    writeProbeTarget = stage;
    options.onProgress?.(`Downloading Node.js ${MANAGED_NODE_VERSION} from nodejs.org…`);
    phase = "download";
    const controller = new AbortController();
    const timer = setTimeout(() => {
      downloadTimedOut = true;
      controller.abort();
    }, options.dependencies?.downloadTimeoutMs ?? INSTALL_TIMEOUT_MS);
    const forwardAbort = () => controller.abort();
    if (options.signal?.aborted) controller.abort();
    else options.signal?.addEventListener("abort", forwardAbort, { once: true });
    let archive: Buffer;
    try {
      const response = await fetcher(artifact.url, {
        signal: controller.signal,
        redirect: "follow",
      });
      if (!response.ok || !isOfficialNodeArtifact(response.url)) {
        throw new Error(
          "Node archive request was redirected outside the approved official source",
        );
      }
      archive = await responseBuffer(
        response,
        artifact.maxBytes,
        controller.signal,
      );
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", forwardAbort);
    }
    throwIfManagedNodeInstallCancelled(options.signal);
    phase = "integrity";
    const digest = options.dependencies?.digest
      ? options.dependencies.digest(archive)
      : createHash("sha256").update(archive).digest("hex");
    if (digest !== artifact.sha256) throw new Error("Node archive digest does not match the reviewed manifest");
    phase = "filesystem";
    writeProbeTarget = stage;
    throwIfManagedNodeInstallCancelled(options.signal);
    await writeFile(path.join(/* turbopackIgnore: true */ stage, artifact.format === "zip" ? "node.zip" : "node.tar.gz"), archive, { mode: 0o600 });
    throwIfManagedNodeInstallCancelled(options.signal);
    const extracted = path.join(/* turbopackIgnore: true */ stage, "extracted");
    await mkdir(/* turbopackIgnore: true */ extracted, { recursive: true });
    throwIfManagedNodeInstallCancelled(options.signal);
    writeProbeTarget = extracted;
    options.onProgress?.("Verifying and extracting the Node.js archive…");
    phase = "archive";
    if (options.dependencies?.extractArchive) {
      await options.dependencies.extractArchive(
        artifact.format,
        archive,
        extracted,
      );
    } else if (artifact.format === "zip") {
      await extractSafeZip(archive, extracted);
    } else {
      await extractSafeTarGz(archive, extracted);
    }
    throwIfManagedNodeInstallCancelled(options.signal);
    const runtime = await runtimeDirectory(extracted);
    phase = "filesystem";
    writeProbeTarget = path.dirname(paths.installDir);
    throwIfManagedNodeInstallCancelled(options.signal);
    await mkdir(/* turbopackIgnore: true */ path.dirname(paths.installDir), { recursive: true });
    throwIfManagedNodeInstallCancelled(options.signal);
    await remove(/* turbopackIgnore: true */ installTemporary, { recursive: true, force: true });
    throwIfManagedNodeInstallCancelled(options.signal);
    await move(/* turbopackIgnore: true */ runtime, installTemporary);
    throwIfManagedNodeInstallCancelled(options.signal);
    await remove(/* turbopackIgnore: true */ paths.installDir, { recursive: true, force: true });
    throwIfManagedNodeInstallCancelled(options.signal);
    await move(/* turbopackIgnore: true */ installTemporary, paths.installDir);
    throwIfManagedNodeInstallCancelled(options.signal);
    writeProbeTarget = paths.npmPrefix;
    await mkdir(/* turbopackIgnore: true */ paths.npmPrefix, { recursive: true });
    options.onProgress?.("Node.js and npm are ready in Cave’s user-scoped toolchain.");
    phase = "verification";
    const installed = await probe({
      platform,
      architecture,
      env: options.env,
      home: options.home,
    });
    return installed.status === "ready"
      ? { ok: true, outcome: "installed", probe: installed }
      : {
          ok: false,
          detail:
            installed.status === "incompatible"
              ? `Managed Node ${installed.version} did not match the reviewed version.`
              : installed.status === "missing"
                ? "Managed Node.js and npm were missing after installation."
                : installed.detail,
          paths: installed.paths,
          failure: "verification_failed",
        };
  } catch (error) {
    const failure = downloadTimedOut
      ? "install_timeout"
      : options.signal?.aborted
        ? "unknown_failure"
      : failureForInstallPhase(phase, error);
    const access = failure === "filesystem_failed"
      ? await (options.dependencies?.writeProbe ?? probeOwnedDirectoryWrite)(
          writeProbeTarget,
        )
      : undefined;
    return {
      ok: false,
      detail:
        error instanceof Error
          ? error.message
          : "Managed Node installation failed",
      paths,
      ...(access ? { applicationData: access } : {}),
      failure:
        failure === "filesystem_failed" && access?.writeProbe === "failed"
          ? "application_data_not_writable"
          : failure,
    };
  } finally {
    await rm(/* turbopackIgnore: true */ stage, { recursive: true, force: true }).catch(() => undefined);
    await rm(/* turbopackIgnore: true */ installTemporary, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function managedToolchainWritable(paths: ManagedNodePaths): Promise<boolean> {
  return (await probeManagedToolchainWriteAccess(paths)).writeProbe === "passed";
}
