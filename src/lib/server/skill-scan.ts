import { readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";

/**
 * Shared SKILL.md directory scanner. Used by /api/skills/local (shared Coven
 * and user skills) and /api/capabilities (supplementing harness manifests when
 * the daemon's own scan misses locally-installed skills).
 */

export type LocalSkillScope = "global" | "user" | "codex-user" | "agents-project" | "agents-user";

export type LocalSkillEntry = {
  id: string;
  name: string;
  description?: string;
  version?: string;
  kind?: string;
  tags?: string[];
  owner?: string;
  repo?: string;
  packageName?: string;
  topics?: string[];
  agents?: string[];
  /**
   * Capabilities the skill needs, declared in its SKILL.md frontmatter as a
   * `permissions:` list (e.g. `web.fetch`, `repo.read`). Surfaced as inherited
   * permissions when the skill is attached to a workflow.
   */
  permissions?: string[];
  /**
   * Frontmatter `argument-hint` (Claude Code convention, e.g. `[pr-number]`).
   * Drives the composer's autofill: a hinted skill inserts `/skill <id> ` for
   * argument editing instead of sending immediately.
   */
  argumentHint?: string;
  path: string;
  familiar: LocalSkillScope;
};

export function parseFrontmatter(text: string): Record<string, string> {
  const fm: Record<string, string> = {};
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return fm;
  const lines = match[1].split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // YAML block scalar — `key: |` (literal) or `key: >` (folded), with the
    // value on the following indented lines. Skill `description:` is almost
    // always written this way; the old single-line regex captured just "|".
    const block = line.match(/^(\w[\w-]*):[ \t]*([|>])[+-]?[ \t]*$/);
    if (block) {
      const key = block[1];
      const folded = block[2] === ">";
      const body: string[] = [];
      let baseIndent: number | null = null;
      let j = i + 1;
      for (; j < lines.length; j++) {
        const l = lines[j];
        if (l.trim() === "") { body.push(""); continue; }
        const indent = l.match(/^[ \t]*/)?.[0].length ?? 0;
        if (baseIndent === null) {
          if (indent === 0) break; // no indented body → empty block
          baseIndent = indent;
        } else if (indent < baseIndent) {
          break; // dedent → next key
        }
        body.push(l.slice(baseIndent));
      }
      while (body.length && body[body.length - 1] === "") body.pop();
      fm[key] = (folded ? body.join(" ") : body.join("\n")).trim();
      i = j - 1;
      continue;
    }
    const m = line.match(/^(\w[\w-]*):\s+"?([^"]*?)"?\s*$/);
    if (m) fm[m[1]] = m[2];
  }
  return fm;
}

export function parseListField(text: string, field: string): string[] {
  const match = text.match(new RegExp(`\\n${field}:\\s*\\n((?:\\s*-[^\\n]*\\n?)*)`));
  if (!match) return [];
  return match[1].match(/- (.+)/g)?.map(m => m.slice(2).trim()) ?? [];
}

export async function scanSkillsDir(dir: string, familiar: LocalSkillScope, out: LocalSkillEntry[]): Promise<void> {
  let entries: string[] = [];
  try {
    const dirents = await readdir(dir, { withFileTypes: true });
    // Skill folders are often symlinks (dotfiles repos, plugin managers) —
    // isDirectory() is false for those, so accept symlinks too; the SKILL.md
    // stat below (which follows links) validates each candidate anyway.
    entries = dirents.filter(e => e.isDirectory() || e.isSymbolicLink()).map(e => e.name);
  } catch { return; }

  for (const skillName of entries) {
    const skillMdPath = path.join(dir, skillName, "SKILL.md");
  try {
      await stat(skillMdPath);
      const text = await readFile(skillMdPath, "utf8");
      const fm = parseFrontmatter(text);
      const tags = parseListField(text, "tags");
      const permissions = parseListField(text, "permissions");
      const topics = parseListField(text, "topics");
      const agents = parseListField(text, "agents");
      out.push({
        id: skillName,
        name: fm.name ?? skillName,
        description: fm.description,
        version: fm.version,
        kind: fm.kind,
        tags: tags.length ? tags : (fm.tags ? [fm.tags] : []),
        permissions: permissions.length ? permissions : undefined,
        argumentHint: fm["argument-hint"],
        owner: fm.owner,
        repo: fm.repo,
        packageName: fm.package,
        topics: topics.length ? topics : undefined,
        agents: agents.length ? agents : undefined,
        path: skillMdPath,
        familiar,
      });
    } catch { continue; }
  }
}

/**
 * Drop entries that are the same skill reached through different scan roots.
 * The Skills CLI symlinks ~/.claude/skills/<id> to its canonical
 * ~/.agents/skills copy, so an aggregate scan sees one physical skill twice
 * and id-keyed consumers render duplicate rows (duplicate React keys).
 * First-seen wins — the aggregation's scan order sets scope precedence.
 */
export async function dedupeByRealPath(entries: LocalSkillEntry[]): Promise<LocalSkillEntry[]> {
  const seen = new Set<string>();
  const out: LocalSkillEntry[] = [];
  for (const entry of entries) {
    let key = entry.path;
    try {
      key = await realpath(entry.path);
    } catch {
      // Unresolvable (dangling symlink, race) — fall back to the declared path.
    }
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
}

/** The user's own Claude Code skills (~/.claude/skills). */
export async function scanClaudeUserSkills(): Promise<LocalSkillEntry[]> {
  const out: LocalSkillEntry[] = [];
  await scanSkillsDir(path.join(homedir(), ".claude", "skills"), "user", out);
  return out;
}

/** Codex global skills installed by `npx skills add -g -a codex`. */
export async function scanCodexUserSkills(): Promise<LocalSkillEntry[]> {
  const out: LocalSkillEntry[] = [];
  await scanSkillsDir(path.join(homedir(), ".codex", "skills"), "codex-user", out);
  return out;
}

/**
 * Shared agent-skills roots used by the Skills CLI:
 * - project `.agents/skills` for Codex and several universal agents
 * - user `~/.agents/skills` as the CLI's canonical shared copy/link root
 */
export async function scanAgentSharedSkills(projectRoot = process.cwd()): Promise<LocalSkillEntry[]> {
  const out: LocalSkillEntry[] = [];
  await scanSkillsDir(path.join(projectRoot, ".agents", "skills"), "agents-project", out);
  await scanSkillsDir(path.join(homedir(), ".agents", "skills"), "agents-user", out);
  return out;
}
