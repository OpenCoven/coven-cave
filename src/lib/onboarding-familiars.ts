export type OnboardingFamiliarDraft = {
  id: string;
  displayName: string;
  role: string;
  description: string;
  glyph: string;
  harness: string;
  model: string;
};

export type OnboardingFamiliarInput = {
  id?: string | null;
  displayName?: string | null;
  role?: string | null;
  description?: string | null;
  glyph?: string | null;
  harness?: string | null;
  model?: string | null;
};

export const RESERVED_STARTER_FAMILIAR_IDS = [
  "main",
  "kitty",
  "cody",
  "sage",
  "charm",
  "astra",
  "echo",
  "nova",
];

function cleanText(value: string | null | undefined): string {
  return (value ?? "").trim();
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function tomlString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function normalizeFamiliarDraft(input: OnboardingFamiliarInput): OnboardingFamiliarDraft {
  const displayName = cleanText(input.displayName);
  if (!displayName) throw new Error("Familiar name is required.");

  const id = slugify(cleanText(input.id) || displayName);
  if (!id) throw new Error("Familiar id is required.");
  if (RESERVED_STARTER_FAMILIAR_IDS.includes(id)) {
    throw new Error(`"${id}" is reserved. Pick a name that belongs to this Coven.`);
  }

  const harness = cleanText(input.harness) || "codex";
  const model = cleanText(input.model) || (harness === "claude" ? "anthropic/claude-sonnet-4-6" : "openai/gpt-5");

  return {
    id,
    displayName,
    role: cleanText(input.role) || "Familiar",
    description: cleanText(input.description),
    glyph: cleanText(input.glyph) || "ph:sparkle-fill",
    harness,
    model,
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

  return `${lines.join("\n")}\n`;
}

export function familiarsTomlContainsId(toml: string, id: string): boolean {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^\\s*id\\s*=\\s*"${escaped}"\\s*$`, "m").test(toml);
}
