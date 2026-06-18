// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Editable preview: POST /api/project-file overwrites an existing text file.
// These assert the write path's safety contract at the source level; the
// behavioural paths (200/400/403/404/413) are exercised live against the built
// server during verification.

const source = await readFile(new URL("./route.ts", import.meta.url), "utf8");

assert.match(source, /export async function POST\(/, "route must export a POST handler for writes");

// Invalid JSON body must be guarded into a 400, not an unhandled throw.
assert.match(
  source,
  /try \{[\s\S]*?await req\.json\(\)[\s\S]*?\} catch \{[\s\S]*?invalid JSON body[\s\S]*?status: 400/,
  "POST must guard invalid JSON bodies with a 400",
);

// Containment must mirror the read path EXACTLY (same inline `..` barrier that
// keeps CodeQL clean): validate via resolveAllowedProjectSubpath, then rebuild
// the target as path.join(root, relativePath).
assert.match(
  source,
  /const allowed = resolveAllowedProjectSubpath\(filePath\);[\s\S]*?if \(!allowed\)[\s\S]*?path not allowed[\s\S]*?const resolved = path\.join\(allowed\.root, allowed\.relativePath\);[\s\S]*?fs\.writeFileSync\(resolved/,
  "writes must rebuild the path from validated root + relativePath, like reads",
);

// Text-only: images and unknown extensions are not editable.
assert.match(
  source,
  /IMAGE_EXTENSIONS\.has\(ext\) \|\| \(ext && !TEXT_EXTENSIONS\.has\(ext\)\)[\s\S]*?is not editable/,
  "writes must reject image and unknown extensions",
);

// .env stays un-writable (it is read-redacted; saving would clobber secrets).
assert.match(
  source,
  /path\.basename\(resolved\)\.startsWith\("\.env"\)[\s\S]*?not editable[\s\S]*?status: 403/,
  "writes must refuse .env files",
);

// Same byte cap as reads.
assert.match(
  source,
  /Buffer\.byteLength\(content, "utf-8"\)[\s\S]*?> MAX_TEXT_SIZE[\s\S]*?status: 413/,
  "writes must cap content at MAX_TEXT_SIZE",
);

// Edits existing files only — a missing target is a 404, never a create.
assert.match(
  source,
  /fs\.statSync\(resolved\)[\s\S]*?file not found[\s\S]*?status: 404/,
  "writes must 404 on a missing target rather than create it",
);

// Non-string content rejected before any filesystem touch.
assert.match(
  source,
  /typeof content !== "string"[\s\S]*?content must be a string[\s\S]*?status: 400/,
  "writes must reject non-string content",
);

console.log("project-file route.test.ts: ok");
