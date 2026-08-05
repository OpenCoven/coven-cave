import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
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

const execFileAsync = promisify(execFile);
const INSTALL_TIMEOUT_MS = 5 * 60_000;

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

type ManagedNodePlatform = "win32" | "darwin" | "linux";

export type ManagedNodeProbe =
  | { status: "ready"; version: string; paths: ManagedNodePaths }
  | { status: "missing"; paths: ManagedNodePaths }
  | { status: "incompatible"; version: string; paths: ManagedNodePaths }
  | { status: "unusable"; detail: string; paths: ManagedNodePaths };

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
    exec?: typeof execFileAsync;
  } = {},
): Promise<ManagedNodeProbe> {
  const paths = managedNodePaths(options.platform, options.architecture, options.env, options.home);
  if (!paths || !existsSync(/* turbopackIgnore: true */ paths.node) || !existsSync(/* turbopackIgnore: true */ paths.npmCli)) return { status: "missing", paths: paths ?? unmanagedPaths() };
  const env = managedNodeSpawnEnv(options.env ?? process.env, paths);
  if (!env) return { status: "missing", paths };
  const run = options.exec ?? execFileAsync;
  try {
    const [{ stdout }, npm] = await Promise.all([
      run(paths.node, ["--version"], { env, timeout: 1500 }),
      run(paths.node, [paths.npmCli, "--version"], { env, timeout: 1500 }),
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
    stagingRoot: path.join(root, "staging"),
    installDir: path.join(root, "unsupported"),
    node: path.join(root, "unsupported", "node"),
    npmCli: path.join(root, "unsupported", "npm-cli.js"),
    npmPrefix: path.join(root, "npm"),
    npmBin: path.join(root, "npm", "bin"),
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
  while (true) {
    if (signal?.aborted) throw new Error("install cancelled");
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) throw new Error("Node archive exceeds the approved size limit");
    chunks.push(value);
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

export async function installManagedNodeToolchain(options: {
  platform?: NodeJS.Platform;
  architecture?: string;
  env?: NodeJS.ProcessEnv;
  home?: string;
  fetch?: typeof fetch;
  signal?: AbortSignal;
  onProgress?: (line: string) => void;
} = {}): Promise<ManagedNodeProbe> {
  const platform = options.platform ?? process.platform;
  const architecture = options.architecture ?? process.arch;
  const paths = managedNodePaths(platform, architecture, options.env, options.home);
  if (!paths || !supportedPlatform(platform) || !supportedArchitecture(architecture)) {
    return { status: "unusable", detail: "This platform or architecture has no approved managed Node archive.", paths: paths ?? unmanagedPaths() };
  }
  const existing = await probeManagedNodeToolchain({ platform, architecture, env: options.env, home: options.home });
  if (existing.status === "ready") return existing;
  const artifact = nodeArchiveFor(platform, architecture);
  if (!artifact || !isOfficialNodeArtifact(artifact.url)) {
    return { status: "unusable", detail: "No approved Node artifact is available for this platform.", paths };
  }
  const fetcher = options.fetch ?? fetch;
  const stage = path.join(/* turbopackIgnore: true */ paths.stagingRoot, `node-${randomUUID()}`);
  const installTemporary = `${paths.installDir}.tmp-${randomUUID()}`;
  try {
    await mkdir(/* turbopackIgnore: true */ stage, { recursive: true });
    options.onProgress?.(`Downloading Node.js ${MANAGED_NODE_VERSION} from nodejs.org…`);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), INSTALL_TIMEOUT_MS);
    const forwardAbort = () => controller.abort();
    options.signal?.addEventListener("abort", forwardAbort, { once: true });
    let response: Response;
    try {
      response = await fetcher(artifact.url, { signal: controller.signal, redirect: "follow" });
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", forwardAbort);
    }
    if (!response.ok || !isOfficialNodeArtifact(response.url)) throw new Error("Node archive request was redirected outside the approved official source");
    const archive = await responseBuffer(response, artifact.maxBytes, options.signal);
    const digest = createHash("sha256").update(archive).digest("hex");
    if (digest !== artifact.sha256) throw new Error("Node archive digest does not match the reviewed manifest");
    await writeFile(path.join(/* turbopackIgnore: true */ stage, artifact.format === "zip" ? "node.zip" : "node.tar.gz"), archive, { mode: 0o600 });
    const extracted = path.join(/* turbopackIgnore: true */ stage, "extracted");
    await mkdir(/* turbopackIgnore: true */ extracted, { recursive: true });
    options.onProgress?.("Verifying and extracting the Node.js archive…");
    if (artifact.format === "zip") await extractSafeZip(archive, extracted);
    else await extractSafeTarGz(archive, extracted);
    const runtime = await onlyRuntimeDirectory(extracted);
    await mkdir(/* turbopackIgnore: true */ path.dirname(paths.installDir), { recursive: true });
    await rm(/* turbopackIgnore: true */ installTemporary, { recursive: true, force: true });
    await rename(/* turbopackIgnore: true */ runtime, installTemporary);
    await rm(/* turbopackIgnore: true */ paths.installDir, { recursive: true, force: true });
    await rename(/* turbopackIgnore: true */ installTemporary, paths.installDir);
    await mkdir(/* turbopackIgnore: true */ paths.npmPrefix, { recursive: true });
    options.onProgress?.("Node.js and npm are ready in Cave’s user-scoped toolchain.");
    return probeManagedNodeToolchain({ platform, architecture, env: options.env, home: options.home });
  } catch (error) {
    return { status: "unusable", detail: error instanceof Error ? error.message : "Managed Node installation failed", paths };
  } finally {
    await rm(/* turbopackIgnore: true */ stage, { recursive: true, force: true }).catch(() => undefined);
    await rm(/* turbopackIgnore: true */ installTemporary, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function managedToolchainWritable(paths: ManagedNodePaths): Promise<boolean> {
  try {
    await mkdir(/* turbopackIgnore: true */ paths.root, { recursive: true });
    const details = await stat(/* turbopackIgnore: true */ paths.root);
    return details.isDirectory();
  } catch {
    return false;
  }
}
