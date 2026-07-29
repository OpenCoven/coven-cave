/**
 * The onboarding prerequisite contract is deliberately free of Node APIs so it
 * can be used by the server, browser UI, release checks, and pure tests.
 * Probes and installers are server-owned implementations of this contract.
 */

export const MANAGED_NODE_VERSION = "24.18.0";

export type PrerequisitePlatform = "win32" | "darwin" | "linux" | "ios" | "android";
export type PrerequisiteArchitecture = "x64" | "arm64";
export type PrerequisiteTier = "native-launch" | "local-runtime" | "feature";
export type PrerequisiteCapability =
  | "desktop"
  | "local-familiar"
  | "runtime"
  | "queue"
  | "project-search"
  | "github"
  | "remote-familiar"
  | "phone-handoff"
  | "developer-mobile";

export type PrerequisiteId =
  | "windows-webview2"
  | "macos-app-runtime"
  | "linux-desktop-runtime"
  | "mobile-remote-daemon"
  | "managed-node"
  | "coven-cli"
  | "runtime-codex"
  | "runtime-claude"
  | "runtime-copilot"
  | "runtime-openclaw"
  | "git"
  | "beads"
  | "ripgrep"
  | "github-cli"
  | "openssh"
  | "tailscale"
  | "developer-mobile-tools";

export type NodeArchive = {
  url: string;
  sha256: string;
  maxBytes: number;
  format: "zip" | "tar.gz";
};

/** Recovery metadata only: native Linux packages must be installed before
 * Cave can render, so onboarding never attempts to invoke a package manager. */
export const LINUX_DESKTOP_RECOVERY_PACKAGES = {
  debian: ["libgtk-3-0", "libwebkit2gtk-4.1-0", "libfuse2"],
  fedora: ["gtk3", "webkit2gtk4.1", "fuse-libs"],
  arch: ["gtk3", "webkit2gtk-4.1", "fuse2"],
} as const;

export type NpmPackage = {
  packageName: string;
  version: string;
  integrity: string;
  binary: string;
};

export type InstallStrategy =
  | { kind: "native"; manualRecovery: string }
  | { kind: "managed-node"; artifacts: Partial<Record<`${PrerequisitePlatform}-${PrerequisiteArchitecture}`, NodeArchive>> }
  | { kind: "managed-npm"; package: NpmPackage }
  | { kind: "manual"; manualRecovery: string };

export type PrerequisiteDefinition = {
  id: PrerequisiteId;
  label: string;
  tier: PrerequisiteTier;
  capabilities: readonly PrerequisiteCapability[];
  platforms: readonly PrerequisitePlatform[];
  architectures?: readonly PrerequisiteArchitecture[];
  dependsOn?: readonly PrerequisiteId[];
  minimumVersion?: string;
  probe: "native" | "managed-node" | "npm-package" | "command" | "service" | "manual";
  install: InstallStrategy;
  requiresPrivilege: boolean;
  restart: "none" | "app" | "system";
  manualRecovery: string;
};

const NODE_BASE = `https://nodejs.org/dist/v${MANAGED_NODE_VERSION}`;
const NODE_MAX_BYTES = 128_000_000;

const managedNodeArtifacts = {
  "win32-x64": {
    url: `${NODE_BASE}/node-v${MANAGED_NODE_VERSION}-win-x64.zip`,
    sha256: "0ae68406b42d7725661da979b1403ec9926da205c6770827f33aac9d8f26e821",
    maxBytes: NODE_MAX_BYTES,
    format: "zip",
  },
  "win32-arm64": {
    url: `${NODE_BASE}/node-v${MANAGED_NODE_VERSION}-win-arm64.zip`,
    sha256: "f274669adb93b1fd0fbf8f21fd078609e9dcc84333d4f2718d2dde3f9a161a01",
    maxBytes: NODE_MAX_BYTES,
    format: "zip",
  },
  "darwin-x64": {
    url: `${NODE_BASE}/node-v${MANAGED_NODE_VERSION}-darwin-x64.tar.gz`,
    sha256: "dfd0dbd3e721503434df7b7205e719f61b3a3a31b2bcf9729b8b91fea240f080",
    maxBytes: NODE_MAX_BYTES,
    format: "tar.gz",
  },
  "darwin-arm64": {
    url: `${NODE_BASE}/node-v${MANAGED_NODE_VERSION}-darwin-arm64.tar.gz`,
    sha256: "e1a97e14c99c803e96c7339403282ea05a499c32f8d83defe9ef5ec66f979ed1",
    maxBytes: NODE_MAX_BYTES,
    format: "tar.gz",
  },
  "linux-x64": {
    url: `${NODE_BASE}/node-v${MANAGED_NODE_VERSION}-linux-x64.tar.gz`,
    sha256: "783130984963dbba9cbd01089eaf2c2efb055c7c1693c943174b967b3050cb8",
    maxBytes: NODE_MAX_BYTES,
    format: "tar.gz",
  },
  "linux-arm64": {
    url: `${NODE_BASE}/node-v${MANAGED_NODE_VERSION}-linux-arm64.tar.gz`,
    sha256: "6b4484c2190274175df9aa8f28e2d758a819cb1c1fe6ab481e2f95b463ab8508",
    maxBytes: NODE_MAX_BYTES,
    format: "tar.gz",
  },
} satisfies Partial<Record<`${PrerequisitePlatform}-${PrerequisiteArchitecture}`, NodeArchive>>;

const npmPackage = (
  packageName: string,
  version: string,
  integrity: string,
  binary: string,
): NpmPackage => ({ packageName, version, integrity, binary });

export const PREREQUISITES: readonly PrerequisiteDefinition[] = [
  {
    id: "windows-webview2",
    label: "Microsoft Edge WebView2 Runtime",
    tier: "native-launch",
    capabilities: ["desktop"],
    platforms: ["win32"],
    probe: "native",
    install: { kind: "native", manualRecovery: "Re-run the signed CovenCave MSI while connected to the internet." },
    requiresPrivilege: false,
    restart: "app",
    manualRecovery: "Re-run the signed CovenCave MSI while connected to the internet.",
  },
  {
    id: "macos-app-runtime",
    label: "Signed and notarized macOS app runtime",
    tier: "native-launch",
    capabilities: ["desktop"],
    platforms: ["darwin"],
    probe: "native",
    install: { kind: "native", manualRecovery: "Move CovenCave to Applications and follow Gatekeeper recovery guidance." },
    requiresPrivilege: false,
    restart: "app",
    manualRecovery: "Move CovenCave to Applications and follow Gatekeeper recovery guidance.",
  },
  {
    id: "linux-desktop-runtime",
    label: "Linux desktop runtime",
    tier: "native-launch",
    capabilities: ["desktop"],
    platforms: ["linux"],
    probe: "native",
    install: { kind: "native", manualRecovery: "Install the documented GTK/WebKit/FUSE runtime package for this distribution, then relaunch CovenCave." },
    requiresPrivilege: true,
    restart: "app",
    manualRecovery: "Install the documented GTK/WebKit/FUSE runtime package for this distribution, then relaunch CovenCave.",
  },
  {
    id: "mobile-remote-daemon",
    label: "Remote Coven daemon",
    tier: "native-launch",
    capabilities: ["desktop"],
    platforms: ["ios", "android"],
    probe: "service",
    install: { kind: "manual", manualRecovery: "Pair this device with a reachable daemon through the guided Tailscale flow." },
    requiresPrivilege: false,
    restart: "none",
    manualRecovery: "Pair this device with a reachable daemon through the guided Tailscale flow.",
  },
  {
    id: "managed-node",
    label: "Coven-managed Node.js and npm",
    tier: "local-runtime",
    capabilities: ["local-familiar", "runtime"],
    platforms: ["win32", "darwin", "linux"],
    architectures: ["x64", "arm64"],
    minimumVersion: MANAGED_NODE_VERSION,
    probe: "managed-node",
    install: { kind: "managed-node", artifacts: managedNodeArtifacts },
    requiresPrivilege: false,
    restart: "none",
    manualRecovery: "Download the matching Node.js 24 archive from nodejs.org and contact support with the verification result.",
  },
  {
    id: "coven-cli",
    label: "Coven CLI",
    tier: "local-runtime",
    capabilities: ["local-familiar"],
    platforms: ["win32", "darwin", "linux"],
    architectures: ["x64", "arm64"],
    dependsOn: ["managed-node"],
    minimumVersion: "0.1.1",
    probe: "npm-package",
    install: { kind: "managed-npm", package: npmPackage("@opencoven/cli", "0.1.6", "sha512-F+NZr4NQ9Yuqe1Oqu4cNLpuFdWSSdz4A+ZhDdPuluXfeQtOZOvwNYc1987B6dmcVdofVxJs/N1bTexbWZGeuNQ==", "coven") },
    requiresPrivilege: false,
    restart: "none",
    manualRecovery: "Run the exact documented package version with the Cave-managed Node/npm lane, then re-check.",
  },
  {
    id: "runtime-codex",
    label: "Codex",
    tier: "feature",
    capabilities: ["runtime"],
    platforms: ["win32", "darwin", "linux"],
    architectures: ["x64", "arm64"],
    dependsOn: ["managed-node", "coven-cli"],
    probe: "npm-package",
    install: { kind: "managed-npm", package: npmPackage("@openai/codex", "0.145.0", "sha512-/PSPSFujjjmiyVFvG2yu/grOFhsWdokTH8t2KGWhXSo/M5n/dIDsnbsnO82/7bLtIoDuzQf7ATBUMWqPWQINlQ==", "codex") },
    requiresPrivilege: false,
    restart: "none",
    manualRecovery: "Install Codex manually and run codex login, then re-check.",
  },
  {
    id: "runtime-claude",
    label: "Claude Code",
    tier: "feature",
    capabilities: ["runtime"],
    platforms: ["win32", "darwin", "linux"],
    architectures: ["x64", "arm64"],
    dependsOn: ["managed-node", "coven-cli"],
    probe: "npm-package",
    install: { kind: "managed-npm", package: npmPackage("@anthropic-ai/claude-code", "2.1.220", "sha512-ogBrvwkqF9f8okmnXKxmRNHuvtFxFEffe5pWdqOV3iQDxlUOKirFqnyWC7NGXXnDA4WkkbPH8pvSbwyCR2Auyw==", "claude") },
    requiresPrivilege: false,
    restart: "none",
    manualRecovery: "Install Claude Code manually and complete claude doctor, then re-check.",
  },
  {
    id: "runtime-copilot",
    label: "GitHub Copilot CLI",
    tier: "feature",
    capabilities: ["runtime"],
    platforms: ["win32", "darwin", "linux"],
    architectures: ["x64", "arm64"],
    dependsOn: ["managed-node", "coven-cli"],
    probe: "npm-package",
    install: { kind: "managed-npm", package: npmPackage("@github/copilot", "1.0.75", "sha512-rn7ZQmhydCZ9XRdG6V78QEhXIdYlChlUvOVAtyJ6KHJGt2O9/71si7PCt84amfmg0N7IXBT2UGRYF4GQDQBt+g==", "copilot") },
    requiresPrivilege: false,
    restart: "none",
    manualRecovery: "Install Copilot manually and sign in, then re-check.",
  },
  {
    id: "runtime-openclaw",
    label: "OpenClaw",
    tier: "feature",
    capabilities: ["runtime"],
    platforms: ["win32", "darwin", "linux"],
    architectures: ["x64", "arm64"],
    dependsOn: ["managed-node", "coven-cli"],
    probe: "npm-package",
    install: { kind: "managed-npm", package: npmPackage("openclaw", "2026.7.1-2", "sha512-ycF3yPcbjN6bUPeaUx6Mh6vze1hQWoD3CT/wWcmD7a8xaHHHRUaAlaq+lFxMHf1ssEgODVAwjlzYqp2twkYZ7g==", "openclaw") },
    requiresPrivilege: false,
    restart: "none",
    manualRecovery: "Install OpenClaw manually and connect or create an agent, then re-check.",
  },
  {
    id: "git", label: "Git", tier: "feature", capabilities: ["queue"], platforms: ["win32", "darwin", "linux"], probe: "command", install: { kind: "manual", manualRecovery: "Install Git through the documented platform flow." }, requiresPrivilege: false, restart: "none", manualRecovery: "Install Git through the documented platform flow.",
  },
  {
    id: "beads", label: "Beads CLI", tier: "feature", capabilities: ["queue"], platforms: ["win32", "darwin", "linux"], probe: "command", install: { kind: "manual", manualRecovery: "Install Beads for the selected Queue project." }, requiresPrivilege: false, restart: "none", manualRecovery: "Install Beads for the selected Queue project.",
  },
  {
    id: "ripgrep", label: "ripgrep", tier: "feature", capabilities: ["project-search"], platforms: ["win32", "darwin", "linux"], probe: "command", install: { kind: "manual", manualRecovery: "Install ripgrep with the documented platform package." }, requiresPrivilege: false, restart: "none", manualRecovery: "Install ripgrep with the documented platform package.",
  },
  {
    id: "github-cli", label: "GitHub CLI", tier: "feature", capabilities: ["github"], platforms: ["win32", "darwin", "linux"], probe: "command", install: { kind: "manual", manualRecovery: "Install GitHub CLI and sign in when GitHub operations are enabled." }, requiresPrivilege: false, restart: "none", manualRecovery: "Install GitHub CLI and sign in when GitHub operations are enabled.",
  },
  {
    id: "openssh", label: "OpenSSH client", tier: "feature", capabilities: ["remote-familiar"], platforms: ["win32", "darwin", "linux"], probe: "command", install: { kind: "manual", manualRecovery: "Install or enable the OpenSSH client, then configure key-based access." }, requiresPrivilege: false, restart: "none", manualRecovery: "Install or enable the OpenSSH client, then configure key-based access.",
  },
  {
    id: "tailscale", label: "Tailscale", tier: "feature", capabilities: ["phone-handoff"], platforms: ["win32", "darwin", "linux", "ios", "android"], probe: "service", install: { kind: "manual", manualRecovery: "Install Tailscale and sign in to the required tailnet." }, requiresPrivilege: false, restart: "none", manualRecovery: "Install Tailscale and sign in to the required tailnet.",
  },
  {
    id: "developer-mobile-tools", label: "Mobile developer tools", tier: "feature", capabilities: ["developer-mobile"], platforms: ["win32", "darwin", "linux"], probe: "manual", install: { kind: "manual", manualRecovery: "Install the documented Xcode, Android SDK, JDK, or platform build tools for the selected development workflow." }, requiresPrivilege: true, restart: "none", manualRecovery: "Install the documented Xcode, Android SDK, JDK, or platform build tools for the selected development workflow.",
  },
];

export type PrerequisiteSelection = {
  platform: PrerequisitePlatform;
  architecture: PrerequisiteArchitecture | "unknown";
  capabilities: readonly PrerequisiteCapability[];
};

export function prerequisiteById(id: PrerequisiteId): PrerequisiteDefinition {
  const definition = PREREQUISITES.find((entry) => entry.id === id);
  if (!definition) throw new Error(`unknown prerequisite: ${id}`);
  return definition;
}

export function resolvePrerequisites(selection: PrerequisiteSelection): PrerequisiteDefinition[] {
  const requested = new Set<PrerequisiteCapability>(["desktop", ...selection.capabilities]);
  const selected = new Map<PrerequisiteId, PrerequisiteDefinition>();
  const include = (definition: PrerequisiteDefinition) => {
    if (selected.has(definition.id)) return;
    if (!definition.platforms.includes(selection.platform)) return;
    if (definition.architectures && !definition.architectures.includes(selection.architecture as PrerequisiteArchitecture)) return;
    selected.set(definition.id, definition);
    for (const dependency of definition.dependsOn ?? []) include(prerequisiteById(dependency));
  };

  for (const definition of PREREQUISITES) {
    if (definition.capabilities.some((capability) => requested.has(capability))) include(definition);
  }

  const tier = (value: PrerequisiteTier) => value === "native-launch" ? 0 : value === "local-runtime" ? 1 : 2;
  const rank = (left: PrerequisiteDefinition, right: PrerequisiteDefinition) =>
    tier(left.tier) - tier(right.tier) || left.label.localeCompare(right.label);
  const pending = new Map(selected);
  const ordered: PrerequisiteDefinition[] = [];
  while (pending.size > 0) {
    const next = [...pending.values()]
      .filter((entry) => (entry.dependsOn ?? []).every((dependency) => !pending.has(dependency)))
      .sort(rank)[0];
    // The manifest is authored in this repository. Fail safely rather than
    // presenting an order that conceals a dependency cycle.
    if (!next) throw new Error("onboarding prerequisite dependency cycle");
    pending.delete(next.id);
    ordered.push(next);
  }
  return ordered;
}

export function nodeArchiveFor(
  platform: PrerequisitePlatform,
  architecture: PrerequisiteArchitecture,
): NodeArchive | null {
  const install = prerequisiteById("managed-node").install;
  if (install.kind !== "managed-node") return null;
  return install.artifacts[`${platform}-${architecture}`] ?? null;
}
