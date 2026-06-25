export type CompatibilityAdapter = {
  id: string;
  label: string;
  binary: string;
  chatSupported: boolean;
  versionArgs?: string[];
  installHint: string;
  source: "bundled";
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

export const COMPATIBILITY_ADAPTERS: CompatibilityAdapter[] = [
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

export function openClawAdapterReport(openclawAgentCount: number): AdapterReport {
  return {
    id: "openclaw",
    label: "OpenClaw",
    binary: "openclaw",
    chatSupported: true,
    installed: openclawAgentCount > 0,
    path: null,
    version: openclawAgentCount > 0
      ? `${openclawAgentCount} agent${openclawAgentCount === 1 ? "" : "s"}`
      : null,
    installHint: "Install OpenClaw with `npm install -g openclaw@latest`, then connect or create an agent under ~/.openclaw/agents.",
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
      label: coven.label,
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

  return [...merged.values()].sort((a, b) => {
    const rank = (id: string) =>
      id === "codex" ? 0 : id === "claude" ? 1 : id === "hermes" ? 2 : id === "openclaw" ? 3 : 4;
    return rank(a.id) - rank(b.id) || a.label.localeCompare(b.label);
  });
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
    hint: "Install Codex, Claude Code, Hermes, or connect an OpenClaw agent, then re-check. External adapters can also be added with Coven adapter manifests.",
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

export function adapterManifestScaffoldForHarness(
  harnessId: string,
): AdapterManifestScaffold | null {
  if (harnessId !== "hermes") return null;
  return {
    filename: "hermes.json",
    contents: `${JSON.stringify(
      {
        adapters: [
          {
            id: "hermes",
            label: "Hermes",
            executable: "hermes",
            interactive_prompt_prefix_args: ["chat", "--source", "coven", "-q"],
            non_interactive_prompt_prefix_args: [
              "chat",
              "--source",
              "coven",
              "-Q",
              "-q",
            ],
            install_hint:
              "Install Hermes with the official script (github.com/NousResearch/hermes-agent#quick-install), run `hermes setup`, and make sure `hermes` is on PATH before using this adapter.",
            system_prompt_flag: null,
          },
        ],
      },
      null,
      2,
    )}\n`,
  };
}
