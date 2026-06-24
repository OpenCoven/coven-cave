import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { parseFamiliarToken, resolveFamiliarIds } from "./command-palette-scope.ts";

const fam = (id: string, display_name: string, name?: string) =>
  ({ id, display_name, name, role: "" }) as Parameters<typeof resolveFamiliarIds>[0][number];

const FAMILIARS = [
  fam("nova", "Nova"),
  fam("val", "Valentina", "val"),
  fam("sage", "Sage"),
];

test("parseFamiliarToken: bare @ scopes to all with empty rest", () => {
  assert.deepEqual(parseFamiliarToken("@"), { token: "", rest: "" });
});

test("parseFamiliarToken: leading @token strips the token from rest", () => {
  assert.deepEqual(parseFamiliarToken("@nova"), { token: "nova", rest: "" });
  assert.deepEqual(parseFamiliarToken("@val readme"), { token: "val", rest: "readme" });
});

test("parseFamiliarToken: mid-query @token keeps the rest as free text", () => {
  assert.deepEqual(parseFamiliarToken("browser @nova"), { token: "nova", rest: "browser" });
  assert.deepEqual(parseFamiliarToken("browser @nova readme"), { token: "nova", rest: "browser readme" });
});

test("parseFamiliarToken: no @ means no scope", () => {
  assert.deepEqual(parseFamiliarToken("hello"), { token: null, rest: "hello" });
});

test("parseFamiliarToken: only the first @token wins", () => {
  // second @ stays as literal text in the rest
  assert.deepEqual(parseFamiliarToken("@nova @val"), { token: "nova", rest: "@val" });
});

test("resolveFamiliarIds: null token → no scope (null)", () => {
  assert.equal(resolveFamiliarIds(FAMILIARS, null), null);
});

test("resolveFamiliarIds: bare token → every familiar", () => {
  const ids = resolveFamiliarIds(FAMILIARS, "");
  assert.deepEqual([...(ids ?? [])].sort(), ["nova", "sage", "val"]);
});

test("resolveFamiliarIds: matches on id / name / display_name, case-insensitive", () => {
  assert.deepEqual([...(resolveFamiliarIds(FAMILIARS, "nova") ?? [])], ["nova"]);
  assert.deepEqual([...(resolveFamiliarIds(FAMILIARS, "val") ?? [])], ["val"]); // name handle
  assert.deepEqual([...(resolveFamiliarIds(FAMILIARS, "SAGE") ?? [])], ["sage"]); // display_name
});

test("resolveFamiliarIds: normalizes display-name whitespace", () => {
  const ids = resolveFamiliarIds([fam("val", "Val Entina")], "valentina");
  assert.deepEqual([...(ids ?? [])], ["val"]);
});

test("resolveFamiliarIds: no familiar matches → empty set (not null)", () => {
  const ids = resolveFamiliarIds(FAMILIARS, "zzz");
  assert.ok(ids instanceof Set);
  assert.equal(ids!.size, 0);
});

// --- Source-text guards for the visible scope chip + no-match behavior ---
const source = readFileSync(new URL("../components/command-palette.tsx", import.meta.url), "utf8");

test("command palette renders a scope chip with an accessible label", () => {
  assert.match(source, /scopeInfo/, "component derives a scopeInfo value for the chip");
  assert.match(source, /role="status"/, "scope chip is an aria status region so the scope is announced");
  assert.match(source, /aria-label=[\s\S]*?Scoped to/, "scope chip has an accessible 'Scoped to …' label");
  assert.match(source, /No familiar matches @/, "scope chip announces when no familiar matches the token");
});

test("no-match regression: an unmatched @token shows suggestions only", () => {
  assert.match(
    source,
    /const familiarSuggestionPool = rank\(noFamiliarMatch \? familiars : familiars\.filter/,
    "unmatched @tokens bypass the empty scope filter so familiar suggestions still render",
  );
  assert.match(
    source,
    /if \(noFamiliarMatch\) return familiarRows;/,
    "when the @token resolves to nothing, no non-familiar rows are returned",
  );
  assert.match(
    source,
    /const salemRows: Row\[\] = query\.trim\(\) && !slashCanonical && !noFamiliarMatch/,
    "the unmatched @token path does not prepend the Salem answer row",
  );
});
