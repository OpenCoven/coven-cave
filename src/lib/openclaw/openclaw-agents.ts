export type OpenClawAgentSummary = {
  id: string;
  displayName: string;
  role: string;
  workspacePath: string | null;
};

function titleFromId(id: string): string {
  return id
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function readIdentityField(markdown: string, field: string): string | null {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = markdown.match(new RegExp(`^-\\s*\\*\\*${escaped}:\\*\\*\\s*(.+)$`, "im"));
  return match?.[1]?.trim() || null;
}

export function summarizeOpenClawAgent(
  id: string,
  identityMarkdown: string | null,
  workspacePath: string | null,
): OpenClawAgentSummary {
  const name = identityMarkdown ? readIdentityField(identityMarkdown, "Name") : null;
  const creature = identityMarkdown ? readIdentityField(identityMarkdown, "Creature") : null;
  const vibe = identityMarkdown ? readIdentityField(identityMarkdown, "Vibe") : null;

  return {
    id,
    displayName: name || titleFromId(id) || id,
    role: creature || vibe || "OpenClaw agent",
    workspacePath,
  };
}
