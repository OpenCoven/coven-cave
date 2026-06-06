// @ts-nocheck
import assert from "node:assert/strict";
import {
  COMPATIBILITY_ADAPTERS,
  mergeAdapterReports,
  adapterSetupState,
} from "./harness-adapters.ts";

assert.deepEqual(
  COMPATIBILITY_ADAPTERS.map((adapter) => adapter.id),
  ["codex", "claude"],
);

const merged = mergeAdapterReports(
  [
    { id: "codex", label: "Codex", binary: "codex", installed: true, path: "/usr/bin/codex", version: "codex 1.0.0" },
    { id: "claude", label: "Claude Code", binary: "claude", installed: false, path: null, version: null },
  ],
  [
    {
      id: "hermes",
      label: "Hermes Agent",
      executable: "hermes",
      available: true,
      install_hint: "Install Hermes.",
      source: "manifest",
      manifest_path: "/tmp/adapters.json",
    },
    {
      id: "codex",
      label: "Codex",
      executable: "codex",
      available: true,
      install_hint: "Install Codex.",
      source: "bundled",
    },
  ],
);

assert.equal(merged.length, 3);
assert.equal(merged.find((adapter) => adapter.id === "codex")?.source, "bundled");
assert.equal(merged.find((adapter) => adapter.id === "hermes")?.source, "manifest");
assert.equal(merged.find((adapter) => adapter.id === "hermes")?.manifestPath, "/tmp/adapters.json");

assert.deepEqual(adapterSetupState(merged), {
  ok: true,
  detail: "Codex, Hermes Agent",
});

assert.deepEqual(adapterSetupState(merged.filter((adapter) => !adapter.installed)), {
  ok: false,
  hint: "Install Codex or Claude Code, then re-check. External adapters can also be added with Coven adapter manifests.",
});
