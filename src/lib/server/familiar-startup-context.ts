import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { UserProfile } from "../user-profile-shared.ts";

export type FamiliarStartupContextFile = {
  relativePath: string;
  absolutePath: string;
  contents: string;
};

type DailyMemoryOptions = {
  now?: Date;
};

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function displayRelativePath(relativePath: string): string {
  return relativePath.split(path.sep).join("/");
}

export function familiarDailyMemoryRelativePath(now = new Date()): string {
  const year = now.getFullYear();
  const month = pad2(now.getMonth() + 1);
  const day = pad2(now.getDate());
  return path.join("memory", `${year}-${month}-${day}.md`);
}

export async function readFamiliarDailyMemoryStartupContext(
  familiarWorkspace: string | undefined,
  options: DailyMemoryOptions = {},
): Promise<FamiliarStartupContextFile | null> {
  if (!familiarWorkspace) return null;
  const relativePath = familiarDailyMemoryRelativePath(options.now);
  const absolutePath = path.join(familiarWorkspace, relativePath);
  try {
    const fileStat = await stat(absolutePath);
    if (!fileStat.isFile()) return null;
    return {
      relativePath,
      absolutePath,
      contents: await readFile(absolutePath, "utf8"),
    };
  } catch {
    return null;
  }
}

/**
 * Operator profile → startup-context block. Only set fields render; an empty
 * profile yields null (zero prompt overhead). Injected on NEW sessions only —
 * resumed sessions already carry it in their history.
 */
export function buildOperatorProfileContext(
  profile: UserProfile | undefined,
): FamiliarStartupContextFile | null {
  if (!profile) return null;
  const lines: string[] = [];
  if (profile.name) lines.push(`Name: ${profile.name}`);
  if (profile.pronouns) lines.push(`Pronouns: ${profile.pronouns}`);
  if (profile.timezone) lines.push(`Timezone: ${profile.timezone}`);
  if (profile.bio) lines.push(`Bio: ${profile.bio}`);
  if (profile.links?.length) {
    lines.push("Links:");
    for (const link of profile.links) lines.push(`- ${link.label} — ${link.url}`);
  }
  if (lines.length === 0) return null;
  return {
    relativePath: "operator-profile",
    absolutePath: "operator-profile",
    contents: ["Operator profile (the human you are working with):", ...lines].join("\n"),
  };
}

export function buildPromptWithFamiliarStartupContext(
  prompt: string,
  files: ReadonlyArray<FamiliarStartupContextFile | null | undefined>,
): string {
  const contextFiles = files.filter((file): file is FamiliarStartupContextFile => Boolean(file));
  const text = prompt.trim();
  if (contextFiles.length === 0) return text;

  const blocks = contextFiles.map((file) =>
    [
      `# ${displayRelativePath(file.relativePath)} instructions for ${file.absolutePath}`,
      file.contents.trimEnd(),
    ].join("\n"),
  );
  const context = [
    "<INSTRUCTIONS>",
    "Project Context (familiar workspace files loaded at session start):",
    ...blocks,
    "</INSTRUCTIONS>",
  ].join("\n\n");

  return text ? `${context}\n\n${text}` : context;
}
