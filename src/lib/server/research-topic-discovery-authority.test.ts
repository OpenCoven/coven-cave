import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Source-contract pin (Unit 2, cave-6sles.11). Proves by construction that the
// discovery runner/store/executor have no web or write authority: no network
// imports, no fetch/web_search call sites, no mission writers in the import
// graph, and no store writes outside topic-jobs/ and topic-proposals/.

const dir = path.dirname(fileURLToPath(import.meta.url));
const SOURCES = {
  runner: path.join(dir, "research-topic-discovery-runner.ts"),
  store: path.join(dir, "research-topic-discovery-store.ts"),
  executor: path.join(dir, "research-model-task-executor.ts"),
} as const;

function readSource(name: keyof typeof SOURCES): string {
  return readFileSync(SOURCES[name], "utf8");
}

// Strips // and /* */ comments but keeps string/template/regex literals, so
// import specifiers remain visible for the forbidden-import checks.
function stripComments(source: string): string {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i += 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) i += 1;
      i += 2;
      out += " ";
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

function skipQuoted(source: string, start: number, quote: string): number {
  let i = start + 1;
  while (i < source.length) {
    const ch = source[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === quote || ch === "\n") return i + 1;
    i += 1;
  }
  return i;
}

function skipTemplate(source: string, start: number): number {
  let i = start + 1;
  while (i < source.length) {
    const ch = source[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === "`") return i + 1;
    if (ch === "$" && source[i + 1] === "{") {
      i += 2;
      let depth = 1;
      while (i < source.length && depth > 0) {
        const inner = source[i];
        if (inner === "\\") {
          i += 2;
          continue;
        }
        if (inner === "`") {
          i = skipTemplate(source, i);
          continue;
        }
        if (inner === '"' || inner === "'") {
          i = skipQuoted(source, i, inner);
          continue;
        }
        if (inner === "{") depth += 1;
        else if (inner === "}") depth -= 1;
        i += 1;
      }
      continue;
    }
    i += 1;
  }
  return i;
}

const REGEX_MAY_FOLLOW = /(?:[(,=:[!&|?{};+\-*%~^<>]|\b(?:return|typeof|instanceof|in|of|new|delete|void|do|else|case|yield|await))$/;

// Strips comments AND string/template/regex literals, so only executable code
// remains (mirrors api-contracts.test.ts's executableSource).
function executableSource(source: string): string {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i += 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) i += 1;
      i += 2;
      out += " ";
      continue;
    }
    if (ch === '"' || ch === "'") {
      i = skipQuoted(source, i, ch);
      out += `${ch}${ch}`;
      continue;
    }
    if (ch === "`") {
      i = skipTemplate(source, i);
      out += "``";
      continue;
    }
    if (ch === "/" && REGEX_MAY_FOLLOW.test(out.trimEnd())) {
      let j = i + 1;
      let inClass = false;
      while (j < source.length) {
        const inner = source[j];
        if (inner === "\\") {
          j += 2;
          continue;
        }
        if (inner === "\n") break;
        if (inner === "[") inClass = true;
        else if (inner === "]") inClass = false;
        else if (inner === "/" && !inClass) {
          j += 1;
          break;
        }
        j += 1;
      }
      i = j;
      out += " ";
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

const NETWORK_IMPORTS = ["node:http", "node:https", "node:net", "node:tls", "undici"];
const MISSION_WRITERS = [
  "saveResearchMission",
  "createResearchMissionWorkspace",
  "research-mission-lifecycle",
  "research-mission-runner",
  "createResearchMission",
  "writeResearchMissionSourceFile",
  "scheduleResearchMission",
];

test("runner, store, and executor import no network or mission-writer modules", () => {
  for (const [name, file] of Object.entries(SOURCES)) {
    const source = stripComments(readSource(name as keyof typeof SOURCES));
    for (const forbidden of NETWORK_IMPORTS) {
      assert.ok(
        !source.includes(forbidden),
        `${file} must not import ${forbidden}`,
      );
    }
    for (const forbidden of MISSION_WRITERS) {
      assert.ok(
        !source.includes(forbidden),
        `${file} must not import or call ${forbidden}`,
      );
    }
  }
});

test("runner, store, and executor have no fetch or web_search call sites", () => {
  for (const [name, file] of Object.entries(SOURCES)) {
    const code = executableSource(readSource(name as keyof typeof SOURCES));
    assert.ok(!/\bfetch\s*\(/.test(code), `${file} must not call fetch`);
    assert.ok(!/\bweb_search\b/.test(code), `${file} must not call web_search`);
  }
});

test("the store writes only under topic-jobs/ and topic-proposals/", () => {
  const source = stripComments(readSource("store"));
  assert.match(source, /path\.join\(root,\s*"topic-jobs"\)/);
  assert.match(source, /path\.join\(root,\s*"topic-proposals"\)/);
  for (const forbidden of ["manifests", "blobs", "receipts", "redactions"]) {
    assert.ok(
      !source.includes(`"${forbidden}"`),
      `the store must not write to ${forbidden}/`,
    );
  }
});

console.log("research topic discovery authority: ok");
