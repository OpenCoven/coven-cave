export type BlogGenerationPreferences = {
  visuals: readonly string[];
  tones: readonly string[];
  audiences: readonly string[];
};

function cleanSelections(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function preferenceLines(preferences: BlogGenerationPreferences): string[] {
  const visuals = cleanSelections(preferences.visuals);
  const tones = cleanSelections(preferences.tones);
  const audiences = cleanSelections(preferences.audiences);
  return [
    visuals.length > 0 ? `Visual direction: ${visuals.join("; ")}` : "",
    tones.length > 0 ? `Tone: ${tones.join("; ")}` : "",
    audiences.length > 0 ? `Audience: ${audiences.join("; ")}` : "",
  ].filter(Boolean);
}

export function blogGenerationDirectionPrefix(
  preferences: BlogGenerationPreferences,
): string {
  const lines = preferenceLines(preferences);
  return lines.length > 0 ? `${lines.join("\n")}\n\nAdditional direction:\n` : "";
}

export function composeBlogGenerationDirections(
  freeform: string,
  preferences: BlogGenerationPreferences,
): string {
  const trimmed = freeform.trim();
  const lines = preferenceLines(preferences);
  if (lines.length === 0) return trimmed;
  if (!trimmed) return lines.join("\n");
  return `${lines.join("\n")}\n\nAdditional direction:\n${trimmed}`;
}
