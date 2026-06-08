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
      "Install Hermes, make sure `hermes` is on PATH, then let Cave create its Coven adapter manifest.",
    source: "bundled",
  },
  {
    id: "openclaw",
    label: "OpenClaw",
    binary: "openclaw",
    chatSupported: false,
    installHint: "Connect or create an OpenClaw agent under ~/.openclaw/agents.",
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

export function isTrustedChatHarness(harness: string): boolean {
  return TRUSTED_CHAT_HARNESSES.has(harness);
}

export function openClawAdapterReport(openclawAgentCount: number): AdapterReport {
  return {
    id: "openclaw",
    label: "OpenClaw",
    binary: "openclaw",
    chatSupported: false,
    installed: openclawAgentCount > 0,
    path: null,
    version: openclawAgentCount > 0
      ? `${openclawAgentCount} agent${openclawAgentCount === 1 ? "" : "s"}`
      : null,
    installHint: "Connect or create an OpenClaw agent under ~/.openclaw/agents.",
    source: "openclaw",
    manifestPath: null,
  };
}

export function covenHelpSupportsAdapterList(helpText: string): boolean {
  return /^\s+adapters?\s+.*\badapters?\b/im.test(helpText);
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
              "Install Hermes, make sure `hermes` is on PATH, and complete Hermes setup before using this adapter.",
            system_prompt_flag: null,
          },
        ],
      },
      null,
      2,
    )}\n`,
  };
}
