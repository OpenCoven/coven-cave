// Helpers for the `/skill` and `/skills` slash commands — the inline
// autocomplete options shown while typing, resolving a typed skill argument to
// a concrete skill, and the invocation prompt. Pure + client-safe: the skills
// list is passed in (fetched from /api/skills/local) so this never pulls server
// code into the bundle. Mirrors slash-model.ts.

export type SkillOption = {
  id: string;
  name: string;
  description?: string;
  /** Scope the skill belongs to (e.g. "global", "user") — shown as a hint. */
  familiar?: string;
  // Extra metadata from /api/skills/local, shown in the picker's detail preview.
  version?: string;
  kind?: string;
  tags?: string[];
  /** Absolute path to the skill directory (shown muted in the preview). */
  path?: string;
};

// `/skills` is the no-arg "show everything" picker; it also accepts a trailing
// filter. `/skill ` (with a space) is the per-arg autocomplete. Bare `/skill`
// (no space) matches neither so the command menu shows both commands first.
const SKILLS_RE = /^\/skills\s*(.*)$/i;
const SKILL_ARG_RE = /^\/skill\s+(.*)$/i;

function filterSkills(skills: SkillOption[], partial: string): SkillOption[] {
  const q = partial.trim().toLowerCase();
  if (!q) return skills;
  return skills.filter(
    (s) =>
      s.id.toLowerCase().includes(q) ||
      s.name.toLowerCase().includes(q) ||
      (s.description?.toLowerCase().includes(q) ?? false),
  );
}

/** Skill options for the inline autocomplete when the composer is in `/skill
 *  <partial>` or `/skills [<partial>]` position. Returns null when the text
 *  isn't a skill picker, so callers fall back to the normal command menu. */
export function skillSlashOptions(text: string, skills: SkillOption[]): SkillOption[] | null {
  const t = text.trimStart();
  const m = t.match(SKILLS_RE) ?? t.match(SKILL_ARG_RE);
  if (!m) return null;
  return filterSkills(skills, m[1]);
}

/** Resolve a typed /skill argument to a concrete skill: exact id/name match
 *  first, then a substring match. Returns null for an empty/unknown argument. */
export function resolveSkillArg(arg: string, skills: SkillOption[]): SkillOption | null {
  const a = arg.trim().toLowerCase();
  if (!a) return null;
  const exact = skills.find((s) => s.id.toLowerCase() === a || s.name.toLowerCase() === a);
  if (exact) return exact;
  const partial = skills.find(
    (s) => s.id.toLowerCase().includes(a) || s.name.toLowerCase().includes(a),
  );
  return partial ?? null;
}

/** The message sent to the active familiar to invoke a skill. The harness owns
 *  Skill execution, so this is a plain directive naming the skill. */
export function buildSkillPrompt(skill: SkillOption): string {
  return `Use the "${skill.name}" skill.`;
}

/** One-line-per-skill list for the bare `/skill` / `/skills` system message. */
export function formatSkillList(skills: SkillOption[]): string {
  if (skills.length === 0) {
    return "No skills found. Add skills under your Coven skills directory or ~/.claude/skills, then try `/skill` again.";
  }
  const lines = skills.map(
    (s) => `  ○ ${s.name} — \`${s.id}\`${s.description ? ` — ${s.description}` : ""}`,
  );
  return `Available skills (type \`/skill <name>\` or pick from the menu):\n${lines.join("\n")}`;
}
