// @ts-nocheck
import assert from "node:assert/strict";

const { codeOutline, codeOutlineLang, CODE_OUTLINE_LIMIT } = await import("./code-outline.ts");

// ── Language resolution ──────────────────────────────────────────────────────

assert.equal(codeOutlineLang("code-surface.ts"), "ts");
assert.equal(codeOutlineLang("CodeWorkbench.TSX"), "ts");
assert.equal(codeOutlineLang("lib.rs"), "rust");
assert.equal(codeOutlineLang("CaveApp.swift"), "swift");
assert.equal(codeOutlineLang("run.py"), "python");
assert.equal(codeOutlineLang("dev-app.sh"), "shell");
assert.equal(codeOutlineLang("AGENTS.md"), "markdown");
// Unknown and extensionless files report `none` so the caller can hide the
// control rather than render an empty outline that looks broken.
assert.equal(codeOutlineLang("Cargo.toml"), "none");
assert.equal(codeOutlineLang("Makefile"), "none");
assert.deepEqual(codeOutline("anything at all", "Makefile"), []);

// ── TypeScript ───────────────────────────────────────────────────────────────

{
  const src = [
    "import { thing } from \"./thing\";",
    "",
    "export type LoopbackGrant = {",
    "  code: string;",
    "};",
    "",
    "export const CALLBACK_PATH = \"/callback\";",
    "",
    "export async function awaitLoopbackGrant(port: number) {",
    "  return null;",
    "}",
    "",
    "export const Panel = ({ id }: Props) => null;",
    "",
    "class Listener {}",
  ].join("\n");
  const out = codeOutline(src, "oauth-loopback.ts");
  assert.deepEqual(out, [
    { kind: "type", name: "LoopbackGrant", line: 3 },
    { kind: "const", name: "CALLBACK_PATH", line: 7 },
    { kind: "fn", name: "awaitLoopbackGrant", line: 9 },
    { kind: "fn", name: "Panel", line: 13 },
    { kind: "class", name: "Listener", line: 15 },
  ]);
}

// An arrow-function const reads as a function, not a constant — that is what a
// reader is jumping to. A plain exported binding stays a constant.
{
  const out = codeOutline("export const go = async () => {};\nexport const N = 4;", "a.ts");
  assert.deepEqual(out.map((s) => s.kind), ["fn", "const"]);
}

// Declarations must start a line. A name mentioned mid-sentence in a comment is
// not a jump target, and inventing one is worse than omitting it.
assert.deepEqual(codeOutline("// see function awaitLoopbackGrant for the rest", "a.ts"), []);

// ── Rust ─────────────────────────────────────────────────────────────────────

{
  const src = [
    "use tauri::AppHandle;",
    "",
    "pub struct LoopbackGrant {",
    "    pub code: String,",
    "}",
    "",
    "impl LoopbackGrant {",
    "    pub async fn redeem(&self) -> Result<(), String> {",
    "        Ok(())",
    "    }",
    "}",
    "",
    "fn build_redirect_uri(port: u16) -> String {",
    "    String::new()",
    "}",
  ].join("\n");
  assert.deepEqual(codeOutline(src, "lib.rs"), [
    { kind: "type", name: "LoopbackGrant", line: 3 },
    { kind: "impl", name: "LoopbackGrant", line: 7 },
    { kind: "fn", name: "redeem", line: 8 },
    { kind: "fn", name: "build_redirect_uri", line: 13 },
  ]);
}

// ── Swift, Python, Shell, Markdown ───────────────────────────────────────────

assert.deepEqual(codeOutline("struct RoomView: View {\n  func body() {}\n}", "RoomView.swift"), [
  { kind: "type", name: "RoomView", line: 1 },
  { kind: "fn", name: "body", line: 2 },
]);
assert.deepEqual(codeOutline("class Store:\n    async def load(self):\n        pass", "store.py"), [
  { kind: "class", name: "Store", line: 1 },
  { kind: "fn", name: "load", line: 2 },
]);
assert.deepEqual(codeOutline("start_server() {\n  :\n}", "dev.sh"), [
  { kind: "fn", name: "start_server", line: 1 },
]);
assert.deepEqual(codeOutline("# Title\n\nbody\n\n### Deep", "AGENTS.md"), [
  { kind: "sec", name: "Title", line: 1 },
  { kind: "sec", name: "Deep", line: 5 },
]);

// ── Cap ──────────────────────────────────────────────────────────────────────

{
  const huge = Array.from({ length: CODE_OUTLINE_LIMIT + 40 }, (_, i) => `function f${i}() {}`).join("\n");
  assert.equal(codeOutline(huge, "big.ts").length, CODE_OUTLINE_LIMIT);
}

console.log("code-outline: ok");
