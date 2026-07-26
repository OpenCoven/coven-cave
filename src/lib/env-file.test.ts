// @ts-nocheck
import assert from "node:assert/strict";

const { upsertEnvContent } = await import("./env-file.ts");

// Replace an existing key in place, preserving comments, blanks, ordering, and
// other values byte-for-byte (the bug: the old route flattened all of this).
{
  const existing = [
    "# GitHub credentials",
    "GITHUB_USERNAME=octocat",
    "",
    "GITHUB_PAT=old-token",
    "OTHER=keep me # not a comment, a value",
    "QUOTED=\"v=with=equals\"",
    "",
  ].join("\n");
  const out = upsertEnvContent(existing, { GITHUB_PAT: "new-token" });
  assert.match(out, /# GitHub credentials/, "comments preserved");
  assert.match(out, /^GITHUB_PAT=new-token$/m, "target key replaced in place");
  assert.match(out, /^GITHUB_USERNAME=octocat$/m, "other keys untouched");
  assert.match(out, /^OTHER=keep me # not a comment, a value$/m, "values with # preserved verbatim");
  assert.match(out, /^QUOTED="v=with=equals"$/m, "quotes and inner = preserved");
  // Order preserved: PAT stays where it was (after the blank line), not appended.
  assert.ok(out.indexOf("GITHUB_PAT") < out.indexOf("OTHER"), "key keeps its original position");
}

// Append a brand-new key at the end.
{
  const out = upsertEnvContent("A=1\n", { B: "2" });
  assert.equal(out, "A=1\nB=2\n");
}

// Add a key to an empty / missing file (no leading blank line).
{
  assert.equal(upsertEnvContent("", { GITHUB_PAT: "tok" }), "GITHUB_PAT=tok\n");
}

// Delete a key (null) — removes its line, leaves the rest.
{
  const out = upsertEnvContent("A=1\nGITHUB_PAT=tok\nB=2\n", { GITHUB_PAT: null });
  assert.equal(out, "A=1\nB=2\n");
}

// Deleting an absent key is a no-op (and doesn't append anything).
{
  assert.equal(upsertEnvContent("A=1\n", { GITHUB_PAT: null }), "A=1\n");
}

// Mixed: replace one, add one, delete one, in a single call.
{
  const out = upsertEnvContent("A=1\nB=2\nC=3\n", { B: "two", D: "4", C: null });
  assert.equal(out, "A=1\nB=two\nD=4\n");
}

// Deleting the only key yields empty content, not a stray newline.
{
  assert.equal(upsertEnvContent("ONLY=x\n", { ONLY: null }), "");
}

// Reject values containing newlines so caller-supplied values cannot inject
// additional KEY=value entries into .env.local.
{
  assert.throws(
    () => upsertEnvContent("", { GITHUB_USERNAME: "alice\nWORKSPACE_ROOT=/" }),
    /must not contain newlines/,
  );
}

console.log("env-file.test.ts: all assertions passed");
