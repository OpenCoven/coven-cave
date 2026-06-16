// @ts-nocheck
import assert from "node:assert/strict";
import {
  filterCapabilityItems,
  normalizeCapabilities,
} from "./capabilities-normalize.ts";

const manifests = [
  {
    harness_id: "codex",
    scanned_at: "2026-06-11T12:00:00.000Z",
    global_instructions: {
      present: true,
      path: "/Users/buns/.codex/AGENTS.md",
      byte_count: 2048,
    },
    skills: [
      {
        id: "review",
        name: "Review",
        source: "local",
        harness_id: "codex",
        path: "/Users/buns/.codex/skills/review",
        description: "Review code",
        tags: ["quality"],
      },
      {
        id: "daily-check",
        name: "Daily Check",
        source: "harness-native",
        harness_id: "codex",
        path: "/Users/buns/.codex/automations/daily-check",
        description: "Run the daily check",
      },
    ],
    plugins: [
      {
        id: "browser",
        name: "Browser",
        source: "plugin",
        harness_id: "codex",
        kind: "plugin",
        enabled: true,
        command: "browser-mcp",
        args: ["--stdio"],
      },
      {
        id: "filesystem",
        name: "Filesystem",
        source: "plugin",
        harness_id: "codex",
        kind: "mcp",
        enabled: false,
        command: "fs-mcp",
      },
    ],
    warnings: [
      {
        kind: "parse",
        path: "/Users/buns/.codex/config.toml",
        message: "Could not parse plugin config",
      },
    ],
  },
  {
    harness_id: "claude",
    scanned_at: "2026-06-11T12:03:00.000Z",
    global_instructions: { present: false },
    skills: [],
    plugins: [],
    warnings: [],
  },
];

const covenSkills = [
  {
    id: "daily-brief",
    name: "Daily Brief",
    description: "Summarize project state",
    version: "1.0.0",
    tags: ["planning"],
  },
];

const view = normalizeCapabilities({ manifests, covenSkills });

assert.equal(view.summary.harnesses, 2);
assert.equal(view.summary.instructions, 1);
assert.equal(view.summary.workflows, 0, "no workflow items from empty manifest");
assert.equal(view.summary.roles, 0, "no role items from empty manifest");
assert.equal(view.summary.mcpServers, 1);
assert.equal(view.summary.disabled, 1);
assert.equal(view.summary.warnings, 1);

assert.deepEqual(
  view.harnesses.map((h) => [h.id, h.label, h.itemCount, h.warningCount]),
  [
    ["codex", "Codex", 2, 1],
    ["claude", "Claude Code", 0, 0],
  ],
);

const ids = view.items.map((item) => item.id);
assert.deepEqual(ids, [
  "codex:instructions:global",
  "codex:mcp:filesystem",
  "codex:warning:0",
]);

const disabledMcp = view.items.find((item) => item.id === "codex:mcp:filesystem");
assert.equal(disabledMcp?.status, "disabled");
assert.equal(disabledMcp?.command, "fs-mcp");

assert.deepEqual(
  filterCapabilityItems(view.items, { query: "config", types: new Set(["warning"]) }).map((item) => item.id),
  ["codex:warning:0"],
);
assert.deepEqual(
  filterCapabilityItems(view.items, { harnessId: "codex", status: "disabled" }).map((item) => item.id),
  ["codex:mcp:filesystem"],
);

console.log("capabilities-normalize.test.ts: ok");
