// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Editable preview: POST /api/project-file overwrites an existing text file.
// These assert the write path's safety contract at the source level; the
// behavioural paths (200/400/403/404/413) are exercised live against the built
// server during verification.

const source = await readFile(new URL("./route.ts", import.meta.url), "utf8");
// The save takes the repository lock under the git toplevel (#5781), the key
// the changes route's commit, revert and restore use, not the project root.
assert.match(
  source,
  /const lockKey = await repositoryLockKey\(path\.join\(allowed\.root, allowed\.relativePath\), allowed\.root\);\s*return withRepositoryMutation\(lockKey,/,
);

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
  /const allowed = resolveAllowedProjectSubpath\(filePath\);[\s\S]*?if \(!allowed\)[\s\S]*?path not allowed[\s\S]*?withRepositoryMutation\(lockKey[\s\S]*?const resolved = path\.join\(allowed\.root, allowed\.relativePath\);[\s\S]*?fs\.writeFileSync\(resolved/,
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

// ES/CommonJS module files (.mjs/.cjs — e.g. scripts/run-tests.mjs, *.test.mjs)
// are JavaScript text and must be previewable + editable, not rejected.
assert.match(source, /"\.mjs",[\s\S]*?"\.cjs",/, ".mjs and .cjs are previewable/editable text extensions");

// Code preview should include common docs/log/project text files, not only
// source files.
assert.match(
  source,
  /"\.markdown",[\s\S]*?"\.log",[\s\S]*?"\.out",[\s\S]*?"\.err",[\s\S]*?"\.trace",[\s\S]*?"\.diff",[\s\S]*?"\.patch",[\s\S]*?"\.csv",[\s\S]*?"\.tsv"/,
  "markdown aliases, logs, diffs, and delimited text files are previewable/editable text extensions",
);

// Optimistic concurrency (#5745): a text read carries a version of its bytes,
// and a save that names the version its edit started from is refused with a
// 409 conflict when the file has changed since, checked under the same
// repository lock as the write, so nothing can slip in between.
assert.match(source, /export function projectFileVersion\(bytes: Buffer \| string\): string \{\s*return createHash\("sha256"\)\.update\(bytes\)/, "the version is a digest of the file's bytes");
assert.match(source, /const bytes = fs\.readFileSync\(resolved\);[\s\S]{0,200}version: projectFileVersion\(bytes\)/, "text reads return the version of the bytes they decoded");
assert.match(
  source,
  /withRepositoryMutation\(lockKey[\s\S]*?if \(typeof expectedVersion === "string"\) \{[\s\S]*?projectFileVersion\(fs\.readFileSync\(resolved\)\)[\s\S]*?if \(current !== expectedVersion\)[\s\S]*?conflict: true[\s\S]*?status: 409[\s\S]*?fs\.writeFileSync\(resolved/,
  "a stale expectedVersion is refused with a 409 conflict before the write, under the lock",
);
assert.match(source, /expectedVersion !== undefined && expectedVersion !== null && typeof expectedVersion !== "string"[\s\S]{0,120}status: 400/, "a malformed expectedVersion is a 400");
assert.match(source, /ok: true, size: byteLength, version: projectFileVersion\(content\)/, "a save returns the new version, so the next save can name it");
assert.match(source, /await projectFileWrite\(filePath, payload\.content, payload\.expectedVersion\)/, "POST passes the precondition through");


// A file that isn't UTF-8 is read-only (#5756): decoding replaced every invalid
// byte with U+FFFD, and the version hashed the raw bytes, so a save of a
// Latin-1 file passed its precondition and rewrote the file.
assert.match(source, /export function isUtf8RoundTrip\(bytes: Buffer\): boolean \{\s*return Buffer\.from\(bytes\.toString\("utf-8"\), "utf-8"\)\.equals\(bytes\);/);
assert.match(source, /utf8: isUtf8RoundTrip\(bytes\),/, "reads say whether the file is UTF-8");
assert.match(
  source,
  /if \(!isUtf8RoundTrip\(fs\.readFileSync\(resolved\)\)\) return \{ body: \{ ok: false, error: NOT_UTF8_ERROR \}, status: 422 \};[\s\S]*?Optimistic concurrency/,
  "a save over a non-UTF-8 file is refused under the lock, before the version check, so Overwrite can't skip it",
);

console.log("project-file route.test.ts: ok");
