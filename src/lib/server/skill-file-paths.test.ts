import assert from "node:assert/strict";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { isAllowedSkillFilePath, MAX_SKILL_FILE_PREVIEW_BYTES } from "./skill-file-paths.ts";

const home = await mkdtemp(path.join(tmpdir(), "coven-skill-paths-"));

async function touch(relativePath: string, contents = "# preview\n") {
  const fullPath = path.join(home, relativePath);
  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, contents);
  return fullPath;
}

const claudeSkill = await touch(path.join(".claude", "skills", "deep-research", "SKILL.md"));
const covenSkill = await touch(path.join(".coven", "skills", "foo", "SKILL.md"));
const codexAutomation = await touch(path.join(".codex", "automations", "daily-check", "automation.toml"), "id = \"daily-check\"\n");
const claudeInstructions = await touch(path.join(".claude", "CLAUDE.md"));
const codexInstructions = await touch(path.join(".codex", "AGENTS.md"));
const nonMarkdown = await touch(path.join(".claude", "skills", "x", "run.sh"));
const arbitraryToml = await touch(path.join(".codex", "config.toml"), "model = \"test\"\n");
const privateMarkdown = await touch(path.join(".claude", "private-not-a-skill.md"));
const outsideMarkdown = await touch(path.join("secrets", "notes.md"));
const prefixSibling = await touch(path.join(".claude-evil", "SKILL.md"));
const symlinkTarget = await touch(path.join("secrets", "outside-secret.md"), "secret\n");
const symlinkPath = path.join(home, ".claude", "skills", "leaky", "SKILL.md");
await mkdir(path.dirname(symlinkPath), { recursive: true });
await symlink(symlinkTarget, symlinkPath);

// Skills live under the harness roots as SKILL.md files.
assert.equal(
  await isAllowedSkillFilePath(claudeSkill, home),
  true,
  "a SKILL.md under ~/.claude/skills is allowed",
);
assert.equal(
  await isAllowedSkillFilePath(covenSkill, home),
  true,
  "a SKILL.md under ~/.coven/skills is allowed",
);
assert.equal(
  await isAllowedSkillFilePath(codexAutomation, home),
  true,
  "a Codex automation.toml under ~/.codex/automations is allowed",
);

// Harness instructions files (CLAUDE.md / AGENTS.md) are allowed under roots.
assert.equal(
  await isAllowedSkillFilePath(claudeInstructions, home),
  true,
  "harness instructions markdown under a root is allowed",
);
assert.equal(
  await isAllowedSkillFilePath(codexInstructions, home),
  true,
  "codex instructions markdown is allowed",
);

// Non-markdown and arbitrary markdown are rejected — only skill docs are previewable.
assert.equal(
  await isAllowedSkillFilePath(nonMarkdown, home),
  false,
  "non-markdown files are rejected",
);
assert.equal(
  await isAllowedSkillFilePath(arbitraryToml, home),
  false,
  "arbitrary TOML under a harness root is rejected",
);
assert.equal(
  await isAllowedSkillFilePath(privateMarkdown, home),
  false,
  "arbitrary markdown under a harness root is rejected",
);

// Out-of-tree paths are rejected even when markdown.
assert.equal(
  await isAllowedSkillFilePath(outsideMarkdown, home),
  false,
  "markdown outside the allow-listed roots is rejected",
);
assert.equal(
  await isAllowedSkillFilePath("/etc/passwd", home),
  false,
  "absolute system paths are rejected",
);

// Traversal cannot escape an allowed root.
assert.equal(
  await isAllowedSkillFilePath(path.join(home, ".claude", "skills", "..", "..", ".ssh", "id_rsa.md"), home),
  false,
  "`..` traversal that escapes the home roots is rejected",
);
assert.equal(await isAllowedSkillFilePath("", home), false, "empty path is rejected");

// A sibling directory that merely shares a prefix must not pass containment.
assert.equal(
  await isAllowedSkillFilePath(prefixSibling, home),
  false,
  "a prefix-sharing sibling root (.claude-evil) must not pass containment",
);

// Symlinks are rejected before readFile can follow them out of an allowed root.
assert.equal(
  await isAllowedSkillFilePath(symlinkPath, home),
  false,
  "symlinked skill files are rejected",
);

assert.equal(MAX_SKILL_FILE_PREVIEW_BYTES, 512 * 1024, "skill previews have a bounded size");

console.log("skill-file-paths.test.ts: ok");
