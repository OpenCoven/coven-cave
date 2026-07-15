import { REGISTRY_RUNTIMES } from "./runtime-registry.gen.ts";

export type CompatibilityAdapter = {
  id: string;
  label: string;
  binary: string;
  chatSupported: boolean;
  versionArgs?: string[];
  installHint: string;
  source: "bundled" | "registry";
};

export type LocalAdapterReport = CompatibilityAdapter & {
  installed: boolean;
  path: string | null;
  version: string | null;
  manifestPath?: null;
};

export type CovenAdapterSummary = {
  id: string;
  label: string;
  executable: string;
  available: boolean;
  install_hint: string;
  source: string;
  manifest_path?: string | null;
};

export type AdapterReport = {
  id: string;
  label: string;
  binary: string;
  chatSupported: boolean;
  installed: boolean;
  path: string | null;
  version: string | null;
  installHint: string;
  source: string;
  manifestPath: string | null;
};

export type AdapterSetupState =
  | { ok: true; detail: string }
  | { ok: false; hint: string };

export type AdapterManifestScaffold = {
  filename: string;
  contents: string;
};

// The hand-curated seed: Cave-specific labels, install copy, and probe args.
// Curated entries win over registry entries with the same id.
const CURATED_ADAPTERS: CompatibilityAdapter[] = [
  {
    id: "codex",
    label: "Codex",
    binary: "codex",
    chatSupported: true,
    installHint:
      "Install Codex with `npm install -g @openai/codex`, then run `codex login`.",
    source: "bundled",
  },
  {
    id: "claude",
    label: "Claude Code",
    binary: "claude",
    chatSupported: true,
    versionArgs: ["--version"],
    installHint:
      "Install Claude Code with `npm install -g @anthropic-ai/claude-code`, then run `claude doctor`.",
    source: "bundled",
  },
  {
    id: "copilot",
    label: "Copilot",
    binary: "copilot",
    chatSupported: true,
    versionArgs: ["--version"],
    installHint:
      "Install GitHub Copilot CLI with `npm install -g @github/copilot`, then run `copilot` and sign in with `/login`. Cave creates its Coven adapter manifest.",
    source: "bundled",
  },
  {
    id: "hermes",
    label: "Hermes",
    binary: "hermes",
    chatSupported: true,
    versionArgs: ["--version"],
    installHint:
      "Install Hermes with the official script from github.com/NousResearch/hermes-agent, then run `hermes setup`. Cave creates its Coven adapter manifest.",
    source: "bundled",
  },
  {
    id: "openclaw",
    label: "OpenClaw",
    binary: "openclaw",
    chatSupported: true,
    installHint: "Install OpenClaw with `npm install -g openclaw@latest`, then connect or create an agent under ~/.openclaw/agents.",
    source: "bundled",
  },
];

// Registry-accepted runtimes (synced from OpenCoven/coven-runtimes by
// `pnpm sync:runtimes`) extend the curated seed. Acceptance into the registry
// carries conformance testing + review, so these are chat-trusted on par with
// the bundled five. Curated entries keep their richer Cave-specific copy.
const REGISTRY_ADAPTERS: CompatibilityAdapter[] = REGISTRY_RUNTIMES.filter(
  (runtime) => !CURATED_ADAPTERS.some((adapter) => adapter.id === runtime.id),
)
  .map((runtime) => ({
    id: runtime.id,
    label: runtime.label,
    binary: runtime.binary,
    chatSupported: true,
    installHint: runtime.installHint,
    source: "registry" as const,
  }))
  .sort((a, b) => a.id.localeCompare(b.id));

export const COMPATIBILITY_ADAPTERS: CompatibilityAdapter[] = [
  ...CURATED_ADAPTERS,
  ...REGISTRY_ADAPTERS,
];

// The familiar creation flow can only complete local/SSH summoning for the
// runtimes it has explicit setup/copy/model behavior for today. OpenClaw is a
// separate agent vessel, and registry additions stay hidden here until the
// circle grows first-class support for their install and binding flow.
export const SUMMONABLE_LOCAL_HARNESS_IDS = [
  "codex",
  "claude",
  "copilot",
  "hermes",
] as const;

const SUMMONABLE_LOCAL_HARNESSES = new Set<string>(SUMMONABLE_LOCAL_HARNESS_IDS);

const TRUSTED_ONBOARDING_HARNESSES = new Set(
  COMPATIBILITY_ADAPTERS.map((adapter) => adapter.id),
);

const TRUSTED_CHAT_HARNESSES = new Set(
  COMPATIBILITY_ADAPTERS.filter((adapter) => adapter.chatSupported).map(
    (adapter) => adapter.id,
  ),
);

export function isTrustedOnboardingHarness(harness: string): boolean {
  return TRUSTED_ONBOARDING_HARNESSES.has(harness);
}

// The daemon and older familiar configs sometimes carry a project/package
// alias instead of the canonical adapter id — e.g. "hermes-agent" (the repo +
// package is NousResearch/hermes-agent, even though its binary is `hermes`).
// A familiar bound to such an alias fails the chat trust gate (a spurious 403)
// and shows up as a SECOND runtime row next to the canonical backfill. Mapping
// aliases (and bare binary names) back to the adapter id fixes both.
const HARNESS_ALIASES: Record<string, string> = {
  "hermes-agent": "hermes",
  "claude-code": "claude",
  "openai-codex": "codex",
  "github-copilot": "copilot",
  "copilot-cli": "copilot",
  // OpenCode's npm package is `opencode-ai` (its binary is `opencode`).
  "opencode-ai": "opencode",
};

export function canonicalHarnessId(harness: string): string {
  if (typeof harness !== "string") return harness;
  const key = harness.trim().toLowerCase();
  if (!key) return harness;
  if (HARNESS_ALIASES[key]) return HARNESS_ALIASES[key];
  const byId = COMPATIBILITY_ADAPTERS.find((a) => a.id.toLowerCase() === key);
  if (byId) return byId.id;
  const byBinary = COMPATIBILITY_ADAPTERS.find((a) => a.binary.toLowerCase() === key);
  if (byBinary) return byBinary.id;
  return harness;
}

export function isTrustedChatHarness(harness: string): boolean {
  return TRUSTED_CHAT_HARNESSES.has(canonicalHarnessId(harness));
}

export function isSummonableLocalHarness(harness: string): boolean {
  return SUMMONABLE_LOCAL_HARNESSES.has(canonicalHarnessId(harness));
}

// The single display-label authority for runtime/harness ids: curated Cave
// copy wins, then the synced registry's accepted label, then the raw id.
// UI surfaces (runtime logo, capabilities map, adapter rows) should delegate
// here instead of keeping their own label tables, which have drifted before
// ("Copilot" vs "GitHub Copilot" vs the registry's "GitHub Copilot CLI").
export function runtimeDisplayLabel(runtime: string): string {
  const id = canonicalHarnessId(runtime);
  const curated = COMPATIBILITY_ADAPTERS.find((adapter) => adapter.id === id);
  if (curated) return curated.label;
  const registry = REGISTRY_RUNTIMES.find((entry) => entry.id === id);
  return registry?.label ?? runtime;
}

export function openClawAdapterReport(openclawAgentCount: number): AdapterReport {
  // Identity/copy comes from the curated entry — the two used to be
  // copy-pasted twins and drifted one edit at a time.
  const curated = CURATED_ADAPTERS.find((adapter) => adapter.id === "openclaw")!;
  return {
    id: curated.id,
    label: curated.label,
    binary: curated.binary,
    chatSupported: curated.chatSupported,
    installed: openclawAgentCount > 0,
    path: null,
    version: openclawAgentCount > 0
      ? `${openclawAgentCount} agent${openclawAgentCount === 1 ? "" : "s"}`
      : null,
    installHint: curated.installHint,
    source: "openclaw",
    manifestPath: null,
  };
}

export function covenHelpSupportsAdapterList(helpText: string): boolean {
  return /^\s+adapters?\s+.*\badapters?\b/im.test(helpText);
}

// Capability probe for the model-parity passthrough. `coven run` rejects unknown
// flags, so Cave must never emit `--model` before the installed CLI advertises
// it. This parses `coven run --help` output for a `--model` option so forwarding
// can be gated to a no-op until the companion CLI change lands.
export function covenRunSupportsModelFlag(helpText: string): boolean {
  if (typeof helpText !== "string" || !helpText) return false;
  return /(^|\s)--model(?![\w-])/m.test(helpText);
}

// Same gated-forwarding probe for `coven run --permission <full|read-only>` (the
// sandbox/permission flag added in @opencoven/cli). Forwarding stays a no-op on
// CLIs that predate the flag, since `coven run` rejects unknown flags.
export function covenRunSupportsPermissionFlag(helpText: string): boolean {
  if (typeof helpText !== "string" || !helpText) return false;
  return /(^|\s)--permission(?![\w-])/m.test(helpText);
}

// Gated-forwarding probe for `coven run --add-dir <DIR>` (repeatable). Granted
// project roots are only real grants if the spawned harness also trusts those
// directories — the runtime-scope preamble alone leaves the harness denying
// every access outside its cwd. Forwarding stays a no-op on CLIs that predate
// the flag, since `coven run` rejects unknown flags.
export function covenRunSupportsAddDirFlag(helpText: string): boolean {
  if (typeof helpText !== "string" || !helpText) return false;
  return /(^|\s)--add-dir(?![\w-])/m.test(helpText);
}

export function mergeAdapterReports(
  localReports: Array<
    Partial<AdapterReport> & {
      id: string;
      label: string;
      binary: string;
      installed: boolean;
      path: string | null;
      version: string | null;
    }
  >,
  covenReports: CovenAdapterSummary[],
): AdapterReport[] {
  const merged = new Map<string, AdapterReport>();

  for (const local of localReports) {
    merged.set(local.id, {
      id: local.id,
      label: local.label,
      binary: local.binary,
      chatSupported: local.chatSupported ?? false,
      installed: local.installed,
      path: local.path,
      version: local.version,
      installHint: local.installHint ?? "",
      source: local.source ?? "bundled",
      manifestPath: local.manifestPath ?? null,
    });
  }

  for (const coven of covenReports) {
    const existing = merged.get(coven.id);
    merged.set(coven.id, {
      id: coven.id,
      // Cave's curated label wins over the daemon manifest's — otherwise a
      // registry-scaffolded manifest ("GitHub Copilot CLI") silently flips
      // the adapters list away from Cave's copy ("Copilot").
      label: existing?.label ?? coven.label,
      binary: coven.executable,
      chatSupported: existing?.chatSupported ?? isTrustedChatHarness(coven.id),
      installed: coven.available || existing?.installed === true,
      path: existing?.path ?? null,
      version: existing?.version ?? null,
      installHint: coven.install_hint || existing?.installHint || "",
      source: coven.source || existing?.source || "manifest",
      manifestPath: coven.manifest_path ?? existing?.manifestPath ?? null,
    });
  }

  // Curated adapters keep their seed order; registry additions follow
  // alphabetically (COMPATIBILITY_ADAPTERS already encodes both). Built once
  // per merge — not inside the comparator, which runs O(n log n) times.
  const rankById = new Map(COMPATIBILITY_ADAPTERS.map((adapter, index) => [adapter.id, index]));
  const rank = (id: string) => rankById.get(id) ?? COMPATIBILITY_ADAPTERS.length;
  return [...merged.values()].sort(
    (a, b) => rank(a.id) - rank(b.id) || a.label.localeCompare(b.label),
  );
}

export function adapterSetupState(reports: AdapterReport[]): AdapterSetupState {
  const ready = reports.filter((adapter) => adapter.installed);
  if (ready.length > 0) {
    return {
      ok: true,
      detail: ready.map((adapter) => adapter.label).join(", "),
    };
  }
  return {
    ok: false,
    hint: "Install a supported runtime (Codex, Claude Code, Copilot, Hermes, a registry runtime, or an OpenClaw agent), then re-check. External adapters can also be added with Coven adapter manifests.",
  };
}

export function runtimeSourceSetupState(
  reports: AdapterReport[],
  openclawAgentCount: number,
): AdapterSetupState {
  const local = adapterSetupState(reports);
  if (local.ok) return local;
  if (openclawAgentCount > 0) {
    return {
      ok: true,
      detail: `${openclawAgentCount} OpenClaw agent${openclawAgentCount === 1 ? "" : "s"}`,
    };
  }
  return local;
}

// Adapter manifests come straight from the synced coven-runtimes registry:
// every scaffold is the exact conformance-tested $COVEN_HOME/adapters document
// that was accepted upstream (copilot and hermes included — their hand-written
// Cave copies were retired in favor of the registry versions, cave-laxg).
export function adapterManifestScaffoldForHarness(
  harnessId: string,
): AdapterManifestScaffold | null {
  const registry = REGISTRY_RUNTIMES.find(
    (runtime) => runtime.id === canonicalHarnessId(harnessId),
  );
  if (!registry) return null;
  return {
    filename: `${registry.id}.json`,
    contents: `${JSON.stringify(registry.adapterManifest, null, 2)}\n`,
  };
}
