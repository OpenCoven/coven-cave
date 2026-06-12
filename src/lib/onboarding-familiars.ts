import { isTrustedOnboardingHarness } from "./harness-adapters.ts";
import {
  isSshRuntime,
  normalizeFamiliarRuntime,
  type SshFamiliarRuntime,
} from "./familiar-runtime.ts";

export type OnboardingFamiliarDraft = {
  id: string;
  displayName: string;
  role: string;
  description: string;
  glyph: string;
  harness: string;
  model: string;
  openclawAgentId?: string;
  /** Optional remote runtime. Persisted to cave-config.json (the binding
   *  source chat reads), never to familiars.toml. */
  runtime?: SshFamiliarRuntime;
};

export type OnboardingFamiliarInput = {
  id?: string | null;
  displayName?: string | null;
  role?: string | null;
  description?: string | null;
  glyph?: string | null;
  harness?: string | null;
  model?: string | null;
  openclawAgentId?: string | null;
  runtime?: {
    kind?: string | null;
    host?: string | null;
    cwd?: string | null;
    command?: string | null;
  } | null;
};

function cleanText(value: string | null | undefined): string {
  return (value ?? "").trim();
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "");
  // Trim trailing dashes without a regex anchored to $ (avoids ReDoS on long dash runs)
  let end = slug.length;
  while (end > 0 && slug[end - 1] === "-") end--;
  return slug.slice(0, Math.min(end, 48));
}

function tomlString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function normalizeFamiliarDraft(input: OnboardingFamiliarInput): OnboardingFamiliarDraft {
  const displayName = cleanText(input.displayName);
  if (!displayName) throw new Error("Familiar name is required.");

  const id = slugify(cleanText(input.id) || displayName);
  if (!id) throw new Error("Familiar id is required.");

  const openclawAgentId = slugify(cleanText(input.openclawAgentId));
  const harness = cleanText(input.harness) || (openclawAgentId ? "openclaw" : "codex");
  if (!isTrustedOnboardingHarness(harness)) {
    throw new Error(`Unsupported harness: ${harness}.`);
  }
  const model = cleanText(input.model) || openclawAgentId || id;

  // A runtime request is all-or-nothing: a partial/invalid SSH config must
  // fail loudly here instead of silently degrading to a local familiar the
  // user believes is remote.
  let runtime: SshFamiliarRuntime | undefined;
  if (input.runtime && cleanText(input.runtime.kind) === "ssh") {
    const normalized = normalizeFamiliarRuntime({
      kind: "ssh",
      host: input.runtime.host ?? "",
      cwd: input.runtime.cwd ?? "",
      command: input.runtime.command ?? "",
    });
    if (!isSshRuntime(normalized)) {
      throw new Error(
        "SSH runtime needs a host (letters, digits, dots, dashes) and a remote working directory.",
      );
    }
    runtime = normalized;
  }

  return {
    id,
    displayName,
    role: cleanText(input.role) || "Familiar",
    description: cleanText(input.description),
    glyph: cleanText(input.glyph) || "ph:sparkle-fill",
    harness,
    model,
    openclawAgentId: openclawAgentId || undefined,
    runtime,
  };
}

export function buildFamiliarsToml(draft: OnboardingFamiliarDraft | null): string {
  const header = "# User familiars for this Coven.\n";
  if (!draft) return header;

  const lines = [
    header.trimEnd(),
    "",
    "[[familiar]]",
    `id = ${tomlString(draft.id)}`,
    `display_name = ${tomlString(draft.displayName)}`,
    `emoji = ${tomlString(draft.glyph)}`,
    `role = ${tomlString(draft.role)}`,
  ];

  if (draft.description) lines.push(`description = ${tomlString(draft.description)}`);
  lines.push(`harness = ${tomlString(draft.harness)}`);
  lines.push(`model = ${tomlString(draft.model)}`);
  if (draft.openclawAgentId) lines.push(`openclaw_agent = ${tomlString(draft.openclawAgentId)}`);

  return `${lines.join("\n")}\n`;
}

export function familiarsTomlContainsId(toml: string, id: string): boolean {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^\\s*id\\s*=\\s*"${escaped}"\\s*$`, "m").test(toml);
}
