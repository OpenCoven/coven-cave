/** Normalize comma- or newline-delimited executor addresses before persistence. */
export function parseExecutorUrls(text: string): string[] {
  return Array.from(new Set(text.split(/\r?\n|,/).map((entry) => entry.trim()).filter(Boolean)));
}

/** Parse `host = /workspace` lines into the persisted host-workspace mapping. */
export function parseHostWorkspaceText(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (key && value) out[key] = value;
  }
  return out;
}

/** Render only valid mappings so the textarea round-trips without blank rows. */
export function formatHostWorkspaceText(map: Record<string, string> | undefined): string {
  if (!map || typeof map !== "object") return "";
  return Object.entries(map).filter(([key, value]) => key.trim() && value.trim()).map(([key, value]) => `${key.trim()}=${value.trim()}`).join("\n");
}
