// @ts-nocheck
import assert from "node:assert/strict";
import {
  COMPATIBILITY_ADAPTERS,
  mergeAdapterReports,
  adapterSetupState,
  runtimeSourceSetupState,
  adapterManifestScaffoldForHarness,
  covenHelpSupportsAdapterList,
} from "./harness-adapters.ts";

assert.deepEqual(
  COMPATIBILITY_ADAPTERS.map((adapter) => adapter.id),
  ["codex", "claude", "hermes"],
);

const merged = mergeAdapterReports(
  [
    {
      id: "codex",
      label: "Codex",
      binary: "codex",
      installed: true,
      path: "/usr/bin/codex",
      version: "codex 1.0.0",
    },
    {
      id: "claude",
      label: "Claude Code",
      binary: "claude",
      installed: false,
      path: null,
      version: null,
    },
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
assert.equal(
  merged.find((adapter) => adapter.id === "codex")?.source,
  "bundled",
);
assert.equal(
  merged.find((adapter) => adapter.id === "hermes")?.source,
  "manifest",
);
assert.equal(
  merged.find((adapter) => adapter.id === "hermes")?.manifestPath,
  "/tmp/adapters.json",
);
assert.equal(
  merged.find((adapter) => adapter.id === "hermes")?.chatSupported,
  true,
);

assert.deepEqual(adapterSetupState(merged), {
  ok: true,
  detail: "Codex, Hermes Agent",
});

assert.deepEqual(
  adapterSetupState(merged.filter((adapter) => !adapter.installed)),
  {
    ok: false,
    hint: "Install Codex, Claude Code, Hermes, or connect an OpenClaw agent, then re-check. External adapters can also be added with Coven adapter manifests.",
  },
);

assert.deepEqual(
  runtimeSourceSetupState(
    merged.map((adapter) => ({ ...adapter, installed: false })),
    2,
  ),
  {
    ok: true,
    detail: "2 OpenClaw agents",
  },
);

const hermesManifest = adapterManifestScaffoldForHarness("hermes");
assert.equal(hermesManifest?.filename, "hermes.json");
assert.deepEqual(JSON.parse(hermesManifest?.contents ?? "{}"), {
  adapters: [
    {
      id: "hermes",
      label: "Hermes",
      executable: "hermes",
      interactive_prompt_prefix_args: ["chat", "--source", "coven", "-q"],
      non_interactive_prompt_prefix_args: [
        "chat",
        "--source",
        "coven",
        "-Q",
        "-q",
      ],
      install_hint:
        "Install Hermes, make sure `hermes` is on PATH, and complete Hermes setup before using this adapter.",
      system_prompt_flag: null,
    },
  ],
});
assert.equal(adapterManifestScaffoldForHarness("codex"), null);

assert.deepEqual(
  runtimeSourceSetupState(
    [
      {
        id: "hermes",
        label: "Hermes",
        binary: "hermes",
        chatSupported: true,
        installed: true,
        path: "/usr/bin/hermes",
        version: "hermes 0.1.0",
        installHint: "",
        source: "bundled",
        manifestPath: null,
      },
    ],
    0,
  ),
  {
    ok: true,
    detail: "Hermes",
  },
);

assert.equal(
  covenHelpSupportsAdapterList(`Coven runs Codex, Claude Code, and future harnesses inside a local, project-scoped session ledger.

Usage: coven [PROMPT]... [COMMAND]

Commands:
  chat       Interactive chat with Coven agents
  daemon     Manage the local Coven daemon
  run        Launch a project-scoped harness session
  sessions   List or search recent Coven sessions
`),
  false,
  "Older Coven help without the adapter command should not trigger `coven adapter list --json` probes",
);

assert.equal(
  covenHelpSupportsAdapterList(`Commands:
  chat       Interactive chat with Coven agents
  adapter    List and diagnose harness adapters
  daemon     Manage the local Coven daemon
`),
  true,
  "Coven help with the adapter command should allow the adapter-list probe",
);
