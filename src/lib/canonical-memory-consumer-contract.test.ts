import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const AUDITED_SOURCES = {
  "src/components/familiars-view-stats.ts": ["CanonicalMemorySummary"],
  "src/components/dashboard/bento-dashboard.tsx": [
    "CanonicalMemorySummary",
    "loadCanonicalMemoryList",
  ],
  "src/components/familiar-analytics-data.ts": [
    "CanonicalMemorySummary",
    "loadCanonicalMemoryList",
  ],
  "src/components/familiar-growth-view.tsx": [
    "CanonicalMemorySummary",
    "loadCanonicalMemoryList",
  ],
  "src/components/profile-card-data.ts": [
    "CanonicalMemorySummary",
    "loadCanonicalMemoryList",
  ],
  "src/components/familiar-studio-inline.tsx": ["loadCanonicalMemoryList"],
  "src/lib/use-milestone-watch.ts": ["loadCanonicalMemoryList"],
  "src/components/salem/ask-salem-view.tsx": ["loadCanonicalMemoryList"],
  "src/lib/salem/ask-salem-thread.ts": ["CanonicalMemoryVerificationState"],
  "src/lib/command-palette-salem-context.ts": [
    "CanonicalMemoryVerificationState",
  ],
} as const;

const CANONICAL_READER_SOURCES = [
  "src/components/familiars-memory-view.tsx",
  "src/components/familiars-memory-utils.ts",
  "src/components/familiars-memory-row.tsx",
  "src/components/canonical-memory-reader.tsx",
  "src/components/familiars-memory-reader.tsx",
] as const;

const READER_ROSTER_SOURCES = [
  ...CANONICAL_READER_SOURCES,
  "src/components/familiars-view.tsx",
  "src/components/familiars-view-sections.tsx",
] as const;

type AuditedPath = keyof typeof AUDITED_SOURCES;

function sourceFor(path: AuditedPath): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n\r]*/g, "");
}

function canonicalImports(source: string): Set<string> {
  const names = new Set<string>();
  const importPattern =
    /\bimport\s+(?:type\s+)?\{([^}]*)\}\s+from\s+["']@\/lib\/canonical-memory(?:-resources)?["']/g;
  for (const match of source.matchAll(importPattern)) {
    for (const imported of match[1].split(",")) {
      const name = imported
        .trim()
        .replace(/^type\s+/, "")
        .split(/\s+as\s+/)[0]
        .trim();
      if (name) names.add(name);
    }
  }
  return names;
}

describe("canonical memory aggregate consumer contract", () => {
  it("audits the complete Task 6 production source set", () => {
    assert.deepEqual(Object.keys(AUDITED_SOURCES), [
      "src/components/familiars-view-stats.ts",
      "src/components/dashboard/bento-dashboard.tsx",
      "src/components/familiar-analytics-data.ts",
      "src/components/familiar-growth-view.tsx",
      "src/components/profile-card-data.ts",
      "src/components/familiar-studio-inline.tsx",
      "src/lib/use-milestone-watch.ts",
      "src/components/salem/ask-salem-view.tsx",
      "src/lib/salem/ask-salem-thread.ts",
      "src/lib/command-palette-salem-context.ts",
    ]);
  });

  for (const [path, requiredImports] of Object.entries(AUDITED_SOURCES) as Array<
    [AuditedPath, readonly string[]]
  >) {
    it(`${path} uses the shared canonical memory contract`, () => {
      const source = sourceFor(path);
      const imports = canonicalImports(source);
      for (const requiredImport of requiredImports) {
        assert.ok(
          imports.has(requiredImport),
          `${path} must import ${requiredImport} from the canonical memory modules`,
        );
      }

      assert.doesNotMatch(
        source,
        /\bfetch\s*\(\s*(["'`])\/api\/coven-memory\1/,
        `${path} must not fetch the canonical list endpoint directly`,
      );
      assert.doesNotMatch(
        withoutComments(source),
        /(["'`])\/api\/coven-memory\1/,
        `${path} must not route the canonical endpoint through a local fetch wrapper`,
      );
      assert.doesNotMatch(
        source,
        /\b(?:type|interface)\s+(?:CovenMemoryEntry|RawCovenEntry)\b/,
        `${path} must not redeclare a canonical memory entry model`,
      );
    });
  }

  it("canonical memory accessors stay camelCase and path-free", () => {
    const canonicalReceiver =
      String.raw`(?:\b(?:entry|summary|canonical[A-Za-z0-9_]*|memory[A-Za-z0-9_]*|coven[A-Za-z0-9_]*)|row\.entry)`;
    const legacyProperty =
      String.raw`(?:familiar_id|updated_at|source_context|fullPath|path)`;
    const legacyAccess = new RegExp(
      `${canonicalReceiver}\\s*(?:\\?\\.|\\.)\\s*${legacyProperty}\\b`,
      "g",
    );
    const legacyDestructure = new RegExp(
      String.raw`\{[^}]*\b${legacyProperty}\b[^}]*\}\s*=\s*${canonicalReceiver}\b`,
      "g",
    );

    for (const path of Object.keys(AUDITED_SOURCES) as AuditedPath[]) {
      const source = sourceFor(path);
      assert.doesNotMatch(
        source,
        legacyAccess,
        `${path} must not read legacy or path-bearing canonical fields`,
      );
      assert.doesNotMatch(
        source,
        legacyDestructure,
        `${path} must not destructure legacy or path-bearing canonical fields`,
      );
    }
  });

  it("Ask Salem canonical memory context exposes safe summary metadata only", () => {
    const source = sourceFor("src/lib/salem/ask-salem-thread.ts");
    const declaration = source.match(
      /export type AskSalemCovenMemory\s*=\s*\{([\s\S]*?)\n\};/,
    );
    assert.ok(declaration, "AskSalemCovenMemory must remain an explicit object type");
    const body = declaration[1];
    for (const field of [
      "title",
      "familiarId",
      "excerpt",
      "sourceLabel",
      "verificationState",
    ]) {
      assert.match(body, new RegExp(`\\b${field}\\s*:`), `missing ${field}`);
    }
    assert.doesNotMatch(body, /\bpath\s*[?:]/, "Ask Salem context must not expose a path");
  });

  it("routes path-free summaries through the discriminated Task 7 reader seam", () => {
    for (const path of CANONICAL_READER_SOURCES) {
      const source = readFileSync(join(process.cwd(), path), "utf8");
      assert.doesNotMatch(
        source,
        /\bRawCovenEntry\b|\bnormalizeCovenEntry\b/,
        `${path} must not retain the path-bearing canonical model`,
      );
    }

    const view = readFileSync(
      join(process.cwd(), "src/components/familiars-memory-view.tsx"),
      "utf8",
    );
    const utilities = readFileSync(
      join(process.cwd(), "src/components/familiars-memory-utils.ts"),
      "utf8",
    );
    const row = readFileSync(
      join(process.cwd(), "src/components/familiars-memory-row.tsx"),
      "utf8",
    );
    const fileReader = readFileSync(
      join(process.cwd(), "src/components/familiars-memory-reader.tsx"),
      "utf8",
    );
    const rows = readFileSync(
      join(process.cwd(), "src/lib/memory-rows.ts"),
      "utf8",
    );

    assert.match(view, /\bCanonicalMemorySummary\b/);
    assert.match(utilities, /\bCanonicalMemorySummary\b/);
    assert.match(view, /buildMemoryRows\(\{\s*canonical:/);
    assert.match(view, /selectedRow\?\.kind === "canonical"/);
    assert.match(
      row,
      /\{ row: CanonicalMemoryRow; onDelete\?: never \}/,
      "canonical row props make delete unrepresentable",
    );
    assert.match(
      fileReader,
      /row: FileMemoryRow \| null/,
      "path-bearing editing stays file-row-only",
    );

    const canonicalRow = rows.match(
      /export type CanonicalMemoryRow = \{([\s\S]*?)\n\};/,
    );
    assert.ok(canonicalRow, "CanonicalMemoryRow remains an explicit type");
    assert.doesNotMatch(
      canonicalRow[1],
      /\b(?:path|contentPath|protection|size)\b/,
      "canonical rows remain path-free and action-free",
    );

    for (const source of [view, utilities]) {
      assert.doesNotMatch(
        withoutComments(source),
        /(["'`])\/api\/coven-memory\1/,
        "reader landing data must use shared canonical resources",
      );
    }
  });

  it("keeps the retired generic cache key out of reader and roster code", () => {
    for (const path of READER_ROSTER_SOURCES) {
      const source = readFileSync(join(process.cwd(), path), "utf8");
      assert.doesNotMatch(
        withoutComments(source),
        /(["'`])agents:coven-memory\1/,
        `${path} must not reference the retired agents:coven-memory resource`,
      );
    }
  });
});
