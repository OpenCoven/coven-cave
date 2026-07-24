// Shared, pure helpers for the skills directory — derived from a registry or
// locally-scanned skill entry. Extracted from skill-browser.tsx so the
// Marketplace "Explore" grid (skill-explore-card / skill-explore-drawer) and
// the skill browser render the same source strings, install/use commands, and
// frontmatter handling.

import type { SkillBrowserEntry } from "@/components/skill-browser";

/** The `owner/repo`, package, or slug the `skills` CLI installs from. */
export function sourceTarget(skill: SkillBrowserEntry): string {
  if (skill.owner && skill.repo) return `${skill.owner}/${skill.repo}`;
  if (skill.packageName) return skill.packageName;
  const parts = skill.slug?.split("/").filter(Boolean) ?? [];
  if (parts.length >= 3) return `${parts[0]}/${parts[1]}`;
  if (parts.length >= 2 && parts[0]?.includes(".")) return parts[0];
  return skill.slug ?? skill.id;
}

/** Normalized source identity, for grouping skills from the same origin. */
export function sourceKey(skill: SkillBrowserEntry): string {
  return sourceTarget(skill).toLowerCase();
}

/** The `--skill` target when a directory row addresses a specific skill within
 *  a multi-skill source, or null when the whole source is the target. */
export function specificSkillName(skill: SkillBrowserEntry): string | null {
  if (skill.owner && skill.repo) return skill.id;
  const parts = skill.slug?.split("/").filter(Boolean) ?? [];
  if (parts.length >= 3) return parts.slice(2).join("/");
  if (parts.length >= 2 && parts[0]?.includes(".")) return skill.id;
  return null;
}

/** Quote a CLI argument only when it contains shell-significant characters. */
export function quoteCliArg(value: string): string {
  if (/^[A-Za-z0-9._@/:+-]+$/.test(value)) return value;
  return `"${value.replace(/(["\\$`])/g, "\\$1")}"`;
}

/** `npx skills add <source> [--skill <name>]` for the given entry. */
export function installCommand(skill: SkillBrowserEntry): string {
  const target = sourceTarget(skill);
  const specific = specificSkillName(skill);
  if (specific) return `npx skills add ${quoteCliArg(target)} --skill ${quoteCliArg(specific)}`;
  return `npx skills add ${quoteCliArg(target)}`;
}

/** `npx skills use <source> [--skill <name>]` for the given entry. */
export function useCommand(skill: SkillBrowserEntry): string {
  const target = sourceTarget(skill);
  const specific = specificSkillName(skill);
  if (specific) return `npx skills use ${quoteCliArg(target)} --skill ${quoteCliArg(specific)}`;
  return `npx skills use ${quoteCliArg(target)}`;
}

// SKILL.md opens with a YAML frontmatter block (name/description/tags) already
// surfaced as the title/badges — strip it so the body reads as prose.
export function stripFrontmatter(text: string): string {
  return text.replace(/^﻿?---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n?/, "").trimStart();
}
