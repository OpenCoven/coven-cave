// Behavioral coverage for the Marketplace Build tab's writer: the composed
// SKILL.md must round-trip through the REAL scanner (skill-scan.ts) — not a
// re-implementation — and writes must be creation-only inside a known root.
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  buildSkill,
  composeSkillMd,
  resolveBuildRoot,
  slugifySkillName,
  validateSkillBuildInput,
} from "./skill-build.ts";
import { parseFrontmatter, parseListField, scanSkillsDir, type LocalSkillEntry } from "./skill-scan.ts";

const home = await mkdtemp(path.join(tmpdir(), "skill-build-home-"));
const coven = path.join(home, ".coven");

// 1. Slug rules — lowercase kebab, path-safe by construction.
assert.equal(slugifySkillName("Release Notes Writer"), "release-notes-writer");
assert.equal(slugifySkillName("  PDF → Text!! v2_final  "), "pdf-text-v2-final");
assert.equal(slugifySkillName("../../etc/passwd"), "etcpasswd", "traversal characters are stripped, not preserved");
assert.equal(slugifySkillName("🔥🔥🔥"), "", "no-alphanumeric names slugify to empty (rejected by validation)");
assert.ok(slugifySkillName(`${"a".repeat(70)}-tail`).length <= 64, "slug is capped");
assert.doesNotMatch(slugifySkillName(`${"a".repeat(63)}--tail`), /-$/, "capped slug never ends on a hyphen");

// 2. Validation — every rejection the route maps to 400.
const valid = {
  name: "Release Notes Writer",
  description: "Draft release notes from merged PRs.",
  instructions: "## Steps\n1. Collect merged PRs.\n",
  root: "coven" as const,
};
assert.equal(validateSkillBuildInput(valid), null);
assert.match(validateSkillBuildInput({ ...valid, name: " " }) ?? "", /name required/);
assert.match(validateSkillBuildInput({ ...valid, name: "!!!" }) ?? "", /letters or numbers/);
assert.match(validateSkillBuildInput({ ...valid, name: "x".repeat(81) }) ?? "", /name too long/);
assert.match(validateSkillBuildInput({ ...valid, description: "" }) ?? "", /description required/);
assert.match(validateSkillBuildInput({ ...valid, description: "x".repeat(501) }) ?? "", /description too long/);
assert.match(validateSkillBuildInput({ ...valid, instructions: "\n" }) ?? "", /instructions required/);
assert.match(validateSkillBuildInput({ ...valid, instructions: "x".repeat(64 * 1024 + 1) }) ?? "", /too large/);
assert.match(
  validateSkillBuildInput({ ...valid, root: "nope" as unknown as typeof valid.root }) ?? "",
  /unknown destination root/,
);

// 3. Root resolution — the four scanner roots, nothing else.
assert.equal(resolveBuildRoot("coven", { covenHome: coven }), path.join(coven, "skills"));
assert.equal(resolveBuildRoot("claude", { home }), path.join(home, ".claude", "skills"));
assert.equal(resolveBuildRoot("codex", { home }), path.join(home, ".codex", "skills"));
assert.equal(resolveBuildRoot("agents", { home }), path.join(home, ".agents", "skills"));

// 4. Composition round-trips through the real frontmatter parser.
const md = composeSkillMd({
  name: 'Say "hello"\nloudly',
  description: "Multi\nline   description.",
  tags: ["release", "notes", "release", "bad\ttag", ""],
  instructions: "Body text.\r\nSecond line.",
});
const fm = parseFrontmatter(md);
assert.equal(fm.name, "Say 'hello' loudly", "newlines/quotes are normalized for the single-line grammar");
assert.equal(fm.description, "Multi line description.");
assert.equal(fm.version, "0.1.0");
assert.deepEqual(parseListField(md, "tags"), ["release", "notes"], "tags dedupe and drop unsafe entries");
assert.match(md, /Body text\.\nSecond line\.\n$/, "CRLF instructions are normalized");

// 5. buildSkill writes <root>/<slug>/SKILL.md and the scanner picks it up.
const built = await buildSkill(valid, { home, covenHome: coven });
assert.ok(built.ok, `build succeeds: ${built.ok ? "" : built.error}`);
if (built.ok) {
  assert.equal(built.slug, "release-notes-writer");
  assert.equal(built.path, path.join(coven, "skills", "release-notes-writer", "SKILL.md"));
  const onDisk = await readFile(built.path, "utf8");
  assert.equal(onDisk, composeSkillMd(valid), "the preview text and the written file are the same artifact");
}
const scanned: LocalSkillEntry[] = [];
await scanSkillsDir(path.join(coven, "skills"), "global", scanned);
assert.equal(scanned.length, 1, "the built skill is visible to the real scanner");
assert.equal(scanned[0].id, "release-notes-writer");
assert.equal(scanned[0].name, "Release Notes Writer");
assert.equal(scanned[0].description, "Draft release notes from merged PRs.");

// 6. Creation-only: an existing skill directory is refused, file untouched.
const dup = await buildSkill({ ...valid, instructions: "OVERWRITE ATTEMPT" }, { home, covenHome: coven });
assert.equal(dup.ok, false);
if (!dup.ok) assert.equal(dup.code, "exists");
if (built.ok) {
  assert.doesNotMatch(await readFile(built.path, "utf8"), /OVERWRITE ATTEMPT/, "duplicate build never overwrites");
}

// 7. Other roots are created on demand.
const claudeBuilt = await buildSkill({ ...valid, root: "claude" }, { home, covenHome: coven });
assert.ok(claudeBuilt.ok && claudeBuilt.path.startsWith(path.join(home, ".claude", "skills")));

// 8. Invalid input never touches the filesystem.
const invalidBuilt = await buildSkill({ ...valid, name: "!!!" }, { home, covenHome: coven });
assert.equal(invalidBuilt.ok, false);
if (!invalidBuilt.ok) assert.equal(invalidBuilt.code, "invalid");

await rm(home, { recursive: true, force: true });
console.log("skill-build.test.ts OK");
