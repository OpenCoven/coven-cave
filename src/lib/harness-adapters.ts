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

export type AdapterSetupState = { ok: true; detail: string } | { ok: false; hint: string };

export const COMPATIBILITY_ADAPTERS: CompatibilityAdapter[] = [
  {
    id: "codex",
    label: "Codex",
    binary: "codex",
    chatSupported: true,
    installHint: "Install Codex with `npm install -g @openai/codex`, then run `codex login`.",
    source: "bundled",
  },
  {
    id: "claude",
    label: "Claude Code",
    binary: "claude",
    chatSupported: true,
    versionArgs: ["--version"],
    installHint: "Install Claude Code with `npm install -g @anthropic-ai/claude-code`, then run `claude doctor`.",
    source: "bundled",
  },
];

export function mergeAdapterReports(
  localReports: Array<Partial<AdapterReport> & { id: string; label: string; binary: string; installed: boolean; path: string | null; version: string | null }>,
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
      chatSupported: existing?.chatSupported ?? (coven.id === "codex" || coven.id === "claude"),
      installed: coven.available || existing?.installed === true,
      path: existing?.path ?? null,
      version: existing?.version ?? null,
      installHint: coven.install_hint || existing?.installHint || "",
      source: coven.source || existing?.source || "manifest",
      manifestPath: coven.manifest_path ?? existing?.manifestPath ?? null,
    });
  }

  return [...merged.values()].sort((a, b) => {
    const rank = (id: string) => (id === "codex" ? 0 : id === "claude" ? 1 : 2);
    return rank(a.id) - rank(b.id) || a.label.localeCompare(b.label);
  });
}

export function adapterSetupState(reports: AdapterReport[]): AdapterSetupState {
  const ready = reports.filter((adapter) => adapter.installed);
  if (ready.length > 0) {
    return { ok: true, detail: ready.map((adapter) => adapter.label).join(", ") };
  }
  return {
    ok: false,
    hint: "Install Codex or Claude Code, then re-check. External adapters can also be added with Coven adapter manifests.",
  };
}
