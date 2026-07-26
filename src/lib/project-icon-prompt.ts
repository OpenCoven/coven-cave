/**
 * Prompt builder for AI-generated project icons.
 *
 * Distinctness comes from two deterministic, per-project inputs: the same
 * root-path hash projectTint() uses (so the generated palette agrees with the
 * project's existing tile tint everywhere it renders) and a motif drawn from
 * that hash — two projects with similar names still land on different
 * hue/motif pairs. A caller-supplied `variant` seed keeps regeneration
 * dynamic: each press produces a fresh composition without losing the
 * project's palette identity.
 */

const MOTIFS = [
  "a faceted geometric crystal",
  "an abstract origami fold",
  "a stylized circuit constellation",
  "a minimal mountain ridge",
  "an orbiting ring system",
  "a woven knot emblem",
  "a branching tree glyph",
  "a layered wave form",
  "a hexagonal lattice fragment",
  "an ascending stair spiral",
  "a keystone arch",
  "a compass rose abstraction",
  "a stacked strata block",
  "a radiant burst sigil",
  "a moebius loop ribbon",
  "an interlocking gear pair",
] as const;

/** Same deterministic uint32 string hash projectTint() uses. */
export function projectIconHash(root: string): number {
  let hash = 0;
  for (let i = 0; i < root.length; i += 1) {
    hash = (hash * 31 + root.charCodeAt(i)) >>> 0;
  }
  return hash;
}

export function projectIconHue(root: string): number {
  return projectIconHash(root) % 360;
}

export function projectIconMotif(root: string): string {
  return MOTIFS[Math.floor(projectIconHash(root) / 360) % MOTIFS.length];
}

function hueName(hue: number): string {
  if (hue < 20) return "crimson red";
  if (hue < 45) return "warm orange";
  if (hue < 70) return "golden amber";
  if (hue < 100) return "chartreuse green";
  if (hue < 150) return "emerald green";
  if (hue < 190) return "teal";
  if (hue < 230) return "azure blue";
  if (hue < 270) return "indigo";
  if (hue < 310) return "violet purple";
  if (hue < 340) return "magenta";
  return "rose pink";
}

/** Strip anything that could smuggle instructions into the image prompt. */
function sanitizeName(name: string): string {
  return name.replace(/[^\p{L}\p{N} ._-]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 64);
}

export function buildProjectIconPrompt(input: {
  name: string;
  root: string;
  variant?: number;
}): string {
  const hue = projectIconHue(input.root);
  const motif = projectIconMotif(input.root);
  const name = sanitizeName(input.name) || "untitled project";
  const variant = Number.isFinite(input.variant) ? Math.abs(Math.trunc(input.variant!)) : 0;
  const compositions = ["centered", "slightly off-center", "diagonal", "isometric"] as const;
  const composition = compositions[variant % compositions.length];

  return [
    `Minimal flat vector app icon for a software project named "${name}".`,
    `Primary subject: ${motif}, ${composition} composition.`,
    `Dominant color: ${hueName(hue)} (hue ~${hue}deg) on a deep, dark, near-black background.`,
    "Bold simple shapes, soft glow accents, no text, no letters, no words,",
    "no borders, no watermark. Crisp and legible at 16x16 pixels.",
  ].join(" ");
}
