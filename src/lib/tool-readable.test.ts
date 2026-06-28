// @ts-nocheck
import assert from "node:assert/strict";

const { humaniseKey, toolReadableFields, prettyToolOutput } = await import("./tool-readable.ts");

// ── humaniseKey: snake/kebab/camel → Title case with acronym fixups ──────────
{
  assert.equal(humaniseKey("file_path"), "File path");
  assert.equal(humaniseKey("newString"), "New string");
  assert.equal(humaniseKey("output-mode"), "Output mode");
  assert.equal(humaniseKey("url"), "URL");
  assert.equal(humaniseKey("api_url"), "API URL");
  assert.equal(humaniseKey("notebook_id"), "Notebook ID");
  assert.equal(humaniseKey(""), "");
}

// ── toolReadableFields: JSON object → ordered, labelled fields ───────────────
{
  const fields = toolReadableFields(
    JSON.stringify({ limit: 100, file_path: "/repo/src/a.ts" }),
  );
  assert.ok(fields, "parses a JSON object payload");
  // file_path sorts before limit (KEY_ORDER), regardless of payload order.
  assert.equal(fields[0].key, "file_path");
  assert.equal(fields[0].label, "File");
  assert.equal(fields[0].kind, "path");
  assert.equal(fields[0].value, "/repo/src/a.ts");
  assert.equal(fields[1].key, "limit");
  assert.equal(fields[1].label, "Limit");
  assert.equal(fields[1].kind, "number");
  assert.equal(fields[1].value, "100");
  assert.equal(fields[1].multiline, false);
}

// Edit-style payload: old/new render as code, multiline.
{
  const fields = toolReadableFields(
    JSON.stringify({ file_path: "/x.ts", old_string: "const a = 1", new_string: "const a = 2" }),
  );
  const find = fields.find((f) => f.key === "old_string");
  assert.equal(find.label, "Find");
  assert.equal(find.kind, "code");
  assert.equal(find.multiline, true);
  const repl = fields.find((f) => f.key === "new_string");
  assert.equal(repl.label, "Replace with");
}

// command → command kind; url → url kind.
{
  const cmd = toolReadableFields(JSON.stringify({ command: "ls -la" }));
  assert.equal(cmd[0].kind, "command");
  const web = toolReadableFields(JSON.stringify({ url: "https://example.com/x" }));
  assert.equal(web[0].kind, "url");
  assert.equal(web[0].label, "URL");
}

// Long strings and newlines flip multiline; short strings stay inline.
{
  const fields = toolReadableFields(
    JSON.stringify({ query: "short", description: "x".repeat(80) }),
  );
  assert.equal(fields.find((f) => f.key === "query").multiline, false);
  assert.equal(fields.find((f) => f.key === "description").multiline, true);
}

// Nested objects/arrays serialise as pretty JSON, kind "json".
{
  const fields = toolReadableFields(JSON.stringify({ todos: [{ id: 1, text: "a" }] }));
  assert.equal(fields[0].kind, "json");
  assert.equal(fields[0].multiline, true);
  assert.match(fields[0].value, /"text": "a"/);
}

// Empty / null / whitespace values are dropped; all-empty → null.
{
  assert.equal(toolReadableFields(JSON.stringify({ a: "", b: null, c: undefined })), null);
  const fields = toolReadableFields(JSON.stringify({ a: "", keep: "yes" }));
  assert.equal(fields.length, 1);
  assert.equal(fields[0].key, "keep");
}

// Non-object payloads (bare string, array, non-JSON, empty) → null.
{
  assert.equal(toolReadableFields(JSON.stringify("just a string")), null);
  assert.equal(toolReadableFields(JSON.stringify([1, 2, 3])), null);
  assert.equal(toolReadableFields("ls -la"), null);
  assert.equal(toolReadableFields(""), null);
  assert.equal(toolReadableFields(null), null);
}

// ── prettyToolOutput: pretty-print JSON output, pass through the rest ────────
{
  assert.equal(prettyToolOutput('{"a":1,"b":2}'), '{\n  "a": 1,\n  "b": 2\n}');
  assert.equal(prettyToolOutput('[1,2]'), "[\n  1,\n  2\n]");
  // Non-JSON text passes through verbatim.
  assert.equal(prettyToolOutput("plain log line"), "plain log line");
  // Malformed JSON-ish text is left alone.
  assert.equal(prettyToolOutput("{not json"), "{not json");
  assert.equal(prettyToolOutput(""), "");
  assert.equal(prettyToolOutput(null), "");
}

console.log("tool-readable.test.ts passed");
