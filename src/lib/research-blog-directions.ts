export type BlogDirections = {
  visual: string[];
  tone: string[];
  audience: string[];
};

export const EMPTY_BLOG_DIRECTIONS: BlogDirections = { visual: [], tone: [], audience: [] };

/** Keep editorial choices in the existing persisted directions contract. */
export function studioGenerationDirections(kind: string, directions: string, choices: BlogDirections): string {
  if (kind !== "blog") return directions;
  const fields: [string, string[]][] = [
    ["Visual direction", choices.visual],
    ["Tone", choices.tone],
    ["Audience", choices.audience],
  ];
  const lines = fields.filter(([, values]) => values.length > 0)
    .map(([label, values]) => `${label}: ${JSON.stringify(values)}`);
  return lines.length === 0 ? directions : [directions, ...lines].filter(Boolean).join("\n\n");
}
