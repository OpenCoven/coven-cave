// @ts-nocheck
import assert from "node:assert/strict";

const { parseRipgrepJson } = await import("./project-search.ts");

/** Build a ripgrep `match` event line as the binary emits it. */
function matchLine(path, lineNumber, text, submatchStart) {
  return JSON.stringify({
    type: "match",
    data: {
      path: { text: path },
      lines: { text },
      line_number: lineNumber,
      submatches: submatchStart === undefined ? [] : [{ start: submatchStart }],
    },
  });
}

// ── basic grouping + fields ──────────────────────────────────────────────────
{
  const stdout = [
    JSON.stringify({ type: "begin", data: { path: { text: "src/a.ts" } } }),
    matchLine("src/a.ts", 12, "const foo = 1;\n", 6),
    matchLine("src/a.ts", 40, "  return foo;\n", 9),
    JSON.stringify({ type: "end", data: { path: { text: "src/a.ts" } } }),
    matchLine("src/b.ts", 3, "foo()\n", 0),
    JSON.stringify({ type: "summary", data: {} }),
  ].join("\n");

  const result = parseRipgrepJson(stdout);
  assert.equal(result.files.length, 2, "two files grouped");
  assert.equal(result.totalMatches, 3);
  assert.equal(result.truncated, false);

  const [a, b] = result.files;
  assert.equal(a.path, "src/a.ts");
  assert.equal(a.matches.length, 2);
  // Preview strips the trailing newline.
  assert.equal(a.matches[0].preview, "const foo = 1;");
  assert.equal(a.matches[0].line, 12);
  // column is 1-based (submatch start + 1).
  assert.equal(a.matches[0].column, 7);
  // No submatch → column falls back to 1.
  assert.equal(b.matches[0].column, 1);
}

// ── leading "./" (from passing "." as the rg search path) is stripped ────────
{
  const result = parseRipgrepJson(matchLine("./src/deep/x.ts", 1, "hit\n", 0));
  assert.equal(result.files[0].path, "src/deep/x.ts", "leading ./ stripped");
}

// ── non-match events and garbled lines are ignored ───────────────────────────
{
  const stdout = [
    "not json at all",
    JSON.stringify({ type: "context", data: { path: { text: "x.ts" }, line_number: 5, lines: { text: "ctx\n" } } }),
    matchLine("x.ts", 5, "hit\n", 0),
    "",
  ].join("\n");
  const result = parseRipgrepJson(stdout);
  assert.equal(result.totalMatches, 1, "only the match event counts");
  assert.equal(result.files[0].matches[0].preview, "hit");
}

// ── empty output (no matches) ────────────────────────────────────────────────
{
  const result = parseRipgrepJson("");
  assert.deepEqual(result.files, []);
  assert.equal(result.totalMatches, 0);
  assert.equal(result.truncated, false);
}

// ── matches with no line_number are skipped ──────────────────────────────────
{
  const bad = JSON.stringify({ type: "match", data: { path: { text: "y.ts" }, lines: { text: "z\n" } } });
  const result = parseRipgrepJson(bad);
  assert.equal(result.totalMatches, 0, "missing line_number → skipped");
}

// ── base64 (`bytes`) paths/lines are skipped, not crashed on ─────────────────
{
  const bytesPath = JSON.stringify({
    type: "match",
    data: { path: { bytes: "3q2+7w==" }, lines: { text: "x\n" }, line_number: 1 },
  });
  const result = parseRipgrepJson(bytesPath);
  assert.equal(result.totalMatches, 0, "non-UTF8 path skipped");
}

// ── global cap truncates ─────────────────────────────────────────────────────
{
  const lines = [];
  for (let i = 1; i <= 10; i++) lines.push(matchLine(`f${i}.ts`, i, `m${i}\n`, 0));
  const result = parseRipgrepJson(lines.join("\n"), { maxMatches: 4 });
  assert.equal(result.totalMatches, 4, "stops at global cap");
  assert.equal(result.truncated, true);
}

// ── per-file cap truncates that file but keeps scanning others ───────────────
{
  const lines = [
    matchLine("big.ts", 1, "a\n", 0),
    matchLine("big.ts", 2, "b\n", 0),
    matchLine("big.ts", 3, "c\n", 0),
    matchLine("small.ts", 1, "d\n", 0),
  ];
  const result = parseRipgrepJson(lines.join("\n"), { maxPerFile: 2 });
  assert.equal(result.truncated, true);
  const big = result.files.find((f) => f.path === "big.ts");
  const small = result.files.find((f) => f.path === "small.ts");
  assert.equal(big.matches.length, 2, "big.ts capped");
  assert.equal(small.matches.length, 1, "small.ts still collected after big.ts overflow");
}

// ── long preview lines are length-capped with an ellipsis ────────────────────
{
  const long = "x".repeat(500);
  const result = parseRipgrepJson(matchLine("m.ts", 1, `${long}\n`, 0), { maxPreviewLen: 10 });
  assert.equal(result.files[0].matches[0].preview, `${"x".repeat(10)}…`);
}

console.log("project-search.test.ts: all assertions passed");
