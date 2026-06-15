import assert from "node:assert/strict";
import path from "node:path";
import { isAllowedSkillFilePath } from "./skill-file-paths.ts";

const home = "/home/witch";

// Skills live under the harness roots as SKILL.md files.
assert.equal(
  isAllowedSkillFilePath(path.join(home, ".claude", "skills", "deep-research", "SKILL.md"), home),
  true,
  "a SKILL.md under ~/.claude/skills is allowed",
);
assert.equal(
  isAllowedSkillFilePath(path.join(home, ".coven", "skills", "foo", "SKILL.md"), home),
  true,
  "a SKILL.md under ~/.coven/skills is allowed",
);

// Harness instructions files (CLAUDE.md / AGENTS.md) are markdown under a root.
assert.equal(
  isAllowedSkillFilePath(path.join(home, ".claude", "CLAUDE.md"), home),
  true,
  "harness instructions markdown under a root is allowed",
);
assert.equal(
  isAllowedSkillFilePath(path.join(home, ".codex", "AGENTS.md"), home),
  true,
  "codex instructions markdown is allowed",
);

// Non-markdown is rejected — only skill docs are previewable.
assert.equal(
  isAllowedSkillFilePath(path.join(home, ".claude", "skills", "x", "run.sh"), home),
  false,
  "non-markdown files are rejected",
);

// Out-of-tree paths are rejected even when markdown.
assert.equal(
  isAllowedSkillFilePath(path.join(home, "secrets", "notes.md"), home),
  false,
  "markdown outside the allow-listed roots is rejected",
);
assert.equal(
  isAllowedSkillFilePath("/etc/passwd", home),
  false,
  "absolute system paths are rejected",
);

// Traversal cannot escape an allowed root.
assert.equal(
  isAllowedSkillFilePath(path.join(home, ".claude", "skills", "..", "..", ".ssh", "id_rsa.md"), home),
  false,
  "`..` traversal that escapes the home roots is rejected",
);
assert.equal(
  isAllowedSkillFilePath("", home),
  false,
  "empty path is rejected",
);

// A sibling directory that merely shares a prefix must not pass containment.
assert.equal(
  isAllowedSkillFilePath(path.join(home, ".claude-evil", "SKILL.md"), home),
  false,
  "a prefix-sharing sibling root (.claude-evil) must not pass containment",
);

console.log("skill-file-paths.test.ts: ok");
