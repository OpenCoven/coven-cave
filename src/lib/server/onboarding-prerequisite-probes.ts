import { execFile } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, readFile, statfs } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  prerequisiteById,
  resolvePrerequisites,
  LINUX_DESKTOP_RECOVERY_PACKAGES,
  type PrerequisiteCapability,
  type PrerequisiteDefinition,
  type PrerequisiteId,
} from "../onboarding-prerequisites.ts";
import { covenSpawnEnv, pickWindowsLauncher } from "../coven-bin.ts";
import { openCovenToolReadinessStatuses } from "../opencoven-tools-status.ts";
import { probeManagedNodeToolchain } from "./managed-node-toolchain.ts";

const execFileAsync = promisify(execFile);
const PROBE_TIMEOUT_MS = 1_500;

export type PrerequisiteProbeState = "pass" | "fail" | "unknown";
export type PrerequisiteProbeResult = {
  id: PrerequisiteId;
  label: string;
  tier: PrerequisiteDefinition["tier"];
  state: PrerequisiteProbeState;
  detail: string;
  manualRecovery: string;
  installable: boolean;
  requiresPrivilege: boolean;
  restart: PrerequisiteDefinition["restart"];
};

function platformId(): "win32" | "darwin" | "linux" | "ios" | "android" {
  if (process.platform === "win32" || process.platform === "darwin" || process.platform === "linux") return process.platform;
  return process.env.TAURI_PLATFORM === "ios" ? "ios" : "android";
}

async function commandPath(binary: string): Promise<string | null> {
  const command = process.platform === "win32" ? "where" : "which";
  try {
    const { stdout } = await execFileAsync(command, [binary], { env: covenSpawnEnv(), timeout: PROBE_TIMEOUT_MS });
    const lines = stdout.split(/\r?\n/);
    return process.platform === "win32" ? pickWindowsLauncher(lines) : lines.map((line) => line.trim()).find(Boolean) ?? null;
  } catch {
    return null;
  }
}

async function writableStateRoot(): Promise<PrerequisiteProbeState> {
  const home = homedir();
  let current = home;
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      await access(current);
      await access(current, fsConstants.W_OK);
      return "pass";
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return "unknown";
      current = parent;
    }
  }
  return "unknown";
}

async function linuxRecoveryHint(): Promise<string> {
  try {
    const osRelease = await readFile("/etc/os-release", "utf8");
    const id = /^ID=(?:"?)([^\n"]+)/m.exec(osRelease)?.[1]?.toLowerCase() ?? "";
    const like = /^ID_LIKE=(?:"?)([^\n"]+)/m.exec(osRelease)?.[1]?.toLowerCase() ?? "";
    const family = `${id} ${like}`;
    const packages = family.includes("debian") || family.includes("ubuntu")
      ? LINUX_DESKTOP_RECOVERY_PACKAGES.debian
      : family.includes("fedora") || family.includes("rhel")
        ? LINUX_DESKTOP_RECOVERY_PACKAGES.fedora
        : family.includes("arch")
          ? LINUX_DESKTOP_RECOVERY_PACKAGES.arch
          : null;
    if (packages) return `Install the distribution packages: ${packages.join(", ")}, then relaunch Cave.`;
  } catch {
    // A container or minimal distro may not expose os-release. Fall through to
    // the manifest's platform-neutral recovery guidance.
  }
  return "Install your distribution's GTK 3, WebKitGTK 4.1, and FUSE/AppImage runtime packages, then relaunch Cave.";
}

async function desktopNativeProbe(definition: PrerequisiteDefinition): Promise<Pick<PrerequisiteProbeResult, "state" | "detail">> {
  const writable = await writableStateRoot();
  if (writable !== "pass") return { state: writable, detail: "Cave could not verify a writable user-data location." };
  try {
    const disk = await statfs(homedir());
    const free = Number(disk.bavail) * Number(disk.bsize);
    if (Number.isFinite(free) && free < 256 * 1024 * 1024) return { state: "fail", detail: "Less than 256 MB is available for Cave state and the managed toolchain." };
  } catch {
    // Unsupported filesystems report unknown capacity but should not prevent a
    // read-only preflight from giving the user the other results.
  }
  if (definition.id === "windows-webview2") {
    try {
      const { stdout } = await execFileAsync("reg", ["query", "HKLM\\SOFTWARE\\Microsoft\\EdgeUpdate\\Clients", "/s"], { timeout: PROBE_TIMEOUT_MS });
      return /webview2/i.test(stdout) ? { state: "pass", detail: "WebView2 runtime is registered for this Windows installation." } : { state: "unknown", detail: "WebView2 could not be confirmed from the registry." };
    } catch {
      return { state: "unknown", detail: "WebView2 is installed by the CovenCave MSI; registry probing was unavailable." };
    }
  }
  if (definition.id === "linux-desktop-runtime") {
    const session = process.env.WAYLAND_DISPLAY || process.env.DISPLAY;
    try {
      const { stdout } = await execFileAsync("ldconfig", ["-p"], { timeout: PROBE_TIMEOUT_MS });
      const webkit = /libwebkit2gtk-4\.1/i.test(stdout);
      const fuse = await commandPath("fusermount3") ?? await commandPath("fusermount");
      if (!webkit || !session) {
        const reason = !session
          ? "No supported graphical Linux session was detected."
          : "WebKitGTK 4.1 is missing; Cave cannot render onboarding.";
        return { state: "fail", detail: `${reason} ${await linuxRecoveryHint()}` };
      }
      return { state: "pass", detail: `GTK/WebKit desktop runtime${fuse ? " and FUSE support" : ""} detected.` };
    } catch {
      return { state: "unknown", detail: "Linux runtime libraries could not be queried; use the distribution recovery instructions before relaunching Cave." };
    }
  }
  return { state: "pass", detail: "Native app runtime and writable user-data location are available." };
}

function npmDefinitionBinary(id: PrerequisiteId): string | null {
  const install = prerequisiteById(id).install;
  return install.kind === "managed-npm" ? install.package.binary : null;
}

async function probeDefinition(definition: PrerequisiteDefinition): Promise<PrerequisiteProbeResult> {
  const base = {
    id: definition.id,
    label: definition.label,
    tier: definition.tier,
    manualRecovery: definition.manualRecovery,
    installable: definition.install.kind === "managed-node" || definition.install.kind === "managed-npm",
    requiresPrivilege: definition.requiresPrivilege,
    restart: definition.restart,
  } as const;
  if (definition.probe === "native") return { ...base, ...(await desktopNativeProbe(definition)) };
  if (definition.probe === "managed-node") {
    const node = await probeManagedNodeToolchain();
    if (node.status === "ready") return { ...base, state: "pass", detail: `Node.js ${node.version} and npm are ready in Cave’s user-scoped toolchain.` };
    if (node.status === "missing") return { ...base, state: "fail", detail: "The Cave-managed Node.js and npm toolchain is not installed." };
    return {
      ...base,
      state: "fail",
      detail: node.status === "unusable" ? node.detail : `Managed Node.js ${node.version} is incompatible.`,
    };
  }
  if (definition.id === "coven-cli") {
    const coven = (await openCovenToolReadinessStatuses()).find((tool) => tool.id === "coven-cli");
    if (coven?.compatible && coven.packageVerified && coven.executableVerified) {
      return { ...base, state: "pass", detail: `${coven.current ?? "Compatible"} verified at ${coven.path ?? coven.binary}.` };
    }
    return { ...base, state: coven?.installed ? "fail" : "fail", detail: coven?.installed ? "Coven is installed but its package, executable, or version could not be verified." : "Coven CLI is not installed." };
  }
  if (definition.probe === "npm-package" || definition.probe === "command") {
    const binary = npmDefinitionBinary(definition.id) ?? ({ git: "git", beads: "bd", ripgrep: "rg", "github-cli": "gh", openssh: "ssh" } as Partial<Record<PrerequisiteId, string>>)[definition.id];
    const found = binary ? await commandPath(binary) : null;
    return { ...base, state: found ? "pass" : "fail", detail: found ? `${binary} is available to Cave at ${found}.` : `${definition.label} is not available to Cave.` };
  }
  if (definition.id === "tailscale") {
    const found = await commandPath("tailscale");
    return { ...base, state: found ? "unknown" : "fail", detail: found ? "Tailscale is installed; sign-in and tailnet reachability are checked when phone handoff is enabled." : "Tailscale is not installed." };
  }
  return { ...base, state: "unknown", detail: "This selected workflow requires manual configuration." };
}

export async function probeOnboardingPrerequisites(capabilities: readonly PrerequisiteCapability[] = ["local-familiar"]): Promise<PrerequisiteProbeResult[]> {
  const architecture = process.arch === "x64" || process.arch === "arm64" ? process.arch : "unknown";
  const definitions = resolvePrerequisites({ platform: platformId(), architecture, capabilities });
  return Promise.all(definitions.map(probeDefinition));
}
