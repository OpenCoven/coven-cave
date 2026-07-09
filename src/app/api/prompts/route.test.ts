// @ts-nocheck
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { writeFileAtomic } from "../../../lib/server/atomic-write.ts";
import {
  PROMPT_SLUG_RE,
  promptSlug,
  serializePromptTemplate,
} from "../../../lib/server/prompt-file.ts";
import { scanPromptsDir } from "../../../lib/server/prompt-scan.ts";

// ── promptSlug: derivation + confinement ─────────────────────────────────────
assert.equal(promptSlug("Release notes"), "release-notes", "spaces become dashes, lowercased");
assert.equal(promptSlug("  PR / Description!  "), "pr-description", "punctuation collapses to single dashes");
assert.equal(promptSlug("---"), null, "nothing usable → null");
assert.equal(promptSlug(""), null, "empty → null");
assert.equal(promptSlug("a".repeat(200))?.length, 64, "slugs cap at 64 chars");

// The slug regex is the DELETE/POST path confinement — traversal shapes must fail.
for (const evil of ["../evil", "a/b", "a\\b", "..", ".", "a.md", "-lead", "UPPER", "a b", ""]) {
  assert.equal(PROMPT_SLUG_RE.test(evil), false, `slug regex rejects ${JSON.stringify(evil)}`);
}
assert.equal(PROMPT_SLUG_RE.test("bug-repro-2"), true, "plain slugs pass");

// ── serialize → scan round-trip (the write side mirrors the read side) ───────
const root = await mkdtemp(path.join(tmpdir(), "prompt-file-"));
try {
  const dir = path.join(root, "prompts");
  await mkdir(dir);
  const body = "Draft release notes since {{last release|the last tag}}.\n\nGroup by {{area}}.";
  const md = serializePromptTemplate({
    name: "Release notes: launch\nedition",
    description: "Turn merges into\nrelease notes",
    icon: "ph:book-open",
    tags: ["release", "writing", "  ", ""],
    body,
  });
  await writeFileAtomic(path.join(dir, "release-notes-launch.md"), md);

  const scanned = [];
  await scanPromptsDir(dir, "user", scanned);
  assert.equal(scanned.length, 1, "the serialized file scans back");
  const p = scanned[0];
  assert.equal(p.id, "release-notes-launch", "id from the filename");
  assert.equal(p.name, "Release notes: launch edition", "newlines in the name flatten to spaces");
  assert.equal(p.description, "Turn merges into release notes", "newlines in the description flatten");
  assert.equal(p.icon, "ph:book-open", "icon survives");
  assert.deepEqual(p.tags, ["release", "writing"], "blank tags are dropped, real ones survive");
  assert.equal(p.body, body, "the body round-trips verbatim (placeholders intact)");
  assert.equal(p.source, "user", "scanned as a user template");

  // No description/icon/tags → minimal frontmatter, still scannable.
  await writeFileAtomic(
    path.join(dir, "bare.md"),
    serializePromptTemplate({ name: "Bare", body: "Just the body." }),
  );
  const again = [];
  await scanPromptsDir(dir, "user", again);
  const bare = again.find((t) => t.id === "bare");
  assert.equal(bare.name, "Bare");
  assert.equal(bare.description, undefined, "no description key when omitted");
  assert.equal(bare.tags, undefined, "no tags key when omitted");
  const bareRaw = await readFile(path.join(dir, "bare.md"), "utf8");
  assert.doesNotMatch(bareRaw, /description:|icon:|tags:/, "omitted fields are omitted, not empty");
} finally {
  await rm(root, { recursive: true, force: true });
}

// ── Route pins: gates, statuses, confinement ─────────────────────────────────
const source = await readFile(new URL("./route.ts", import.meta.url), "utf8");

assert.match(source, /export async function POST/, "the route grows a POST (save template)");
assert.match(source, /export async function DELETE/, "the route grows a DELETE (remove template)");
// Desktop-only: both mutations behind the loopback gate, before any body read.
assert.match(
  source,
  /export async function POST\(req: Request\) \{\s*\n\s*if \(!isLocalOrigin\(req\)\)/,
  "POST is desktop-only (403 off-loopback) before reading the body",
);
assert.match(
  source,
  /export async function DELETE\(req: Request\) \{\s*\n\s*if \(!isLocalOrigin\(req\)\)/,
  "DELETE is desktop-only (403 off-loopback)",
);
assert.match(source, /\{ status: 403 \}/, "off-loopback mutations 403");
assert.match(source, /\{ status: 400 \}/, "bad input 400s");
assert.match(source, /raw\.overwrite !== true/, "existing files 409 unless overwrite is explicitly true");
assert.match(source, /\{ status: 409 \}/, "exists-without-overwrite is a 409");
// Path confinement: the slug regex is the only path component; DELETE never
// takes a caller path.
assert.match(
  source,
  /if \(!PROMPT_SLUG_RE\.test\(id\)\) \{[\s\S]{0,200}?status: 400/,
  "DELETE validates the id against the slug regex before touching the filesystem",
);
assert.match(
  source,
  /unlink\(path\.join\(userPromptsDir\(\), `\$\{path\.basename\(id\)\}\.md`\)\)/,
  "DELETE joins the validated slug through path.basename — never a caller-supplied path",
);
assert.match(
  source,
  /path\.join\(dir, `\$\{path\.basename\(id\)\}\.md`\)/,
  "POST routes the slug through path.basename (the recognized path-injection sanitizer)",
);
assert.match(source, /writeFileAtomic/, "saves are atomic writes");
assert.match(
  source,
  /await scanPromptsDir\(dir, "user", scanned\)/,
  "POST returns the template as the scanner sees it (round-trip guarantee)",
);
assert.doesNotMatch(source, /rmdir|rm\(/, "the route never removes directories");

console.log("prompts route.test.ts: ok");
