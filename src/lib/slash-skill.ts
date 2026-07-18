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
  /** SKILL.md `argument-hint` (e.g. `[pr-number]`). A hinted skill autofills
   *  `/skill <id> ` for argument editing instead of sending immediately. */
  argumentHint?: string;
};

// `/skills` is the no-arg "show everything" picker; it also accepts a trailing
// filter. `/skill ` (with a space) is the per-arg autocomplete. Bare `/skill`
// (no space) matches neither so the command menu shows both commands first.
const SKILLS_RE = /^\/skills\s*(.*)$/i;
const SKILL_ARG_RE = /^\/skill\s+(.*)$/i;

/** One row per skill id, first scope wins. /api/skills/local concatenates
 *  several scan roots and the Skills CLI installs the same skill under both
 *  ~/.claude/skills and ~/.agents/skills, so raw lists carry duplicates —
 *  rendering them keys React children by a now-non-unique `s.id` and shows
 *  every such skill twice. Scan order already encodes scope precedence. */
export function dedupeSkillsById(skills: SkillOption[]): SkillOption[] {
  const seen = new Set<string>();
  const out: SkillOption[] = [];
  for (const s of skills) {
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    out.push(s);
  }
  return out;
}

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
  return filterSkills(dedupeSkillsById(skills), m[1]);
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

/** Resolve a typed `/skill` argument that may carry trailing arguments after
 *  the skill name. The whole string is tried first (multi-word names keep
 *  working), then the first token as the name with the remainder as the
 *  skill's arguments. Returns null when nothing resolves. */
export function resolveSkillInvocation(
  arg: string,
  skills: SkillOption[],
): { skill: SkillOption; args: string } | null {
  const whole = resolveSkillArg(arg, skills);
  if (whole) return { skill: whole, args: "" };
  const t = arg.trim();
  const sp = t.indexOf(" ");
  if (sp <= 0) return null;
  const skill = resolveSkillArg(t.slice(0, sp), skills);
  return skill ? { skill, args: t.slice(sp + 1).trim() } : null;
}

/** The message sent to the active familiar to invoke a skill. The harness owns
 *  Skill execution, so this is a plain directive naming the skill; typed
 *  arguments (from `/skill <name> <args>`) ride along after it. */
export function buildSkillPrompt(skill: SkillOption, args?: string): string {
  const a = args?.trim();
  if (!a) return `Use the "${skill.name}" skill.`;
  return `Use the "${skill.name}" skill with: ${a}`;
}

/** Skills surfaced directly in the top-level slash menu — typing `/revi`
 *  matches the code-review skill without the /skill prefix. Gated to 3+ typed
 *  characters so `/` and two-letter prefixes keep the command menu clean, and
 *  capped so skills complement rather than crowd the commands. Deduped so
 *  multi-root copies don't eat the five slots. */
export function skillCommandMatches(prefix: string, skills: SkillOption[]): SkillOption[] {
  if (!prefix.startsWith("/")) return [];
  const q = prefix.slice(1).toLowerCase();
  if (q.length < 3) return [];
  const out: SkillOption[] = [];
  for (const s of dedupeSkillsById(skills)) {
    if (!(s.id.toLowerCase().includes(q) || s.name.toLowerCase().includes(q))) continue;
    out.push(s);
    if (out.length === 5) break;
  }
  return out;
}

/** One-line-per-skill list for the bare `/skill` / `/skills` system message. */
export function formatSkillList(skills: SkillOption[]): string {
  const unique = dedupeSkillsById(skills);
  if (unique.length === 0) {
    return "No skills found. Add skills under your Coven skills directory or ~/.claude/skills, then try `/skill` again.";
  }
  const lines = unique.map(
    (s) => `  ○ ${s.name} — \`${s.id}\`${s.description ? ` — ${s.description}` : ""}`,
  );
  return `Available skills (type \`/skill <name>\` or pick from the menu):\n${lines.join("\n")}`;
}
