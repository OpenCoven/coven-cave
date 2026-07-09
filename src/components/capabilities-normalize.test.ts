// @ts-nocheck
import assert from "node:assert/strict";
import {
  filterCapabilityItems,
  harnessLabel,
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
assert.equal(view.summary.skills, 3);
assert.equal(view.summary.plugins, 1);
assert.equal(view.summary.workflows, 0, "no workflow items from empty manifest");
assert.equal(view.summary.roles, 0, "no role items from empty manifest");
assert.equal(view.summary.mcpServers, 1);
assert.equal(view.summary.disabled, 1);
assert.equal(view.summary.warnings, 1);

assert.deepEqual(
  view.harnesses.map((h) => [h.id, h.label, h.itemCount, h.warningCount]),
  [
    ["codex", "Codex", 5, 1],
    ["claude", "Claude Code", 0, 0],
  ],
);

const ids = view.items.map((item) => item.id);
assert.deepEqual(ids, [
  "codex:instructions:global",
  "codex:plugin:browser",
  "codex:mcp:filesystem",
  "codex:skill:review",
  "codex:skill:daily-check",
  "codex:warning:0",
  "coven:skill:daily-brief",
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

// harnessLabel delegates to the shared runtime label authority — every Coven
// adapter id resolves to real display copy (openclaw/hermes used to fall
// through to the raw lowercase id / a drifted registry label), while
// non-adapter editor harnesses keep their local labels.
assert.equal(harnessLabel("openclaw"), "OpenClaw");
assert.equal(harnessLabel("hermes"), "Hermes");
assert.equal(harnessLabel("copilot"), "Copilot");
assert.equal(harnessLabel("opencode"), "OpenCode");
assert.equal(harnessLabel("cursor"), "Cursor");
assert.equal(harnessLabel("gemini"), "Gemini CLI");
assert.equal(harnessLabel("unknown-thing"), "unknown-thing");

console.log("capabilities-normalize.test.ts: ok");
