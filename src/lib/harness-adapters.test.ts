// @ts-nocheck
import assert from "node:assert/strict";
import {
  COMPATIBILITY_ADAPTERS,
  mergeAdapterReports,
  adapterSetupState,
  runtimeSourceSetupState,
  adapterManifestScaffoldForHarness,
  covenHelpSupportsAdapterList,
  covenRunSupportsModelFlag,
  isTrustedChatHarness,
  isTrustedOnboardingHarness,
  openClawAdapterReport,
  canonicalHarnessId,
} from "./harness-adapters.ts";

// Model-parity gating probe: forwarding `--model` must stay off until the
// installed `coven run` advertises the flag.
assert.equal(
  covenRunSupportsModelFlag(`Usage: coven run [OPTIONS] <HARNESS> [PROMPT]...

Options:
      --stream-json  Emit stream-json events
      --model <MODEL>  Model id to pass through to the harness
      --continue <ID>  Resume a session
`),
  true,
  "Help text advertising --model should enable forwarding",
);

assert.equal(
  covenRunSupportsModelFlag(`Usage: coven run [OPTIONS] <HARNESS> [PROMPT]...

Options:
      --stream-json  Emit stream-json events
      --continue <ID>  Resume a session
`),
  false,
  "Help text without --model should keep forwarding off",
);

assert.equal(covenRunSupportsModelFlag(""), false, "Empty help text never enables forwarding");
assert.equal(covenRunSupportsModelFlag(undefined), false, "Non-string help text never enables forwarding");
assert.equal(
  covenRunSupportsModelFlag("see also --model-context-protocol for MCP"),
  false,
  "A substring like --model-context-protocol must not be mistaken for --model",
);

assert.deepEqual(
  COMPATIBILITY_ADAPTERS.map((adapter) => adapter.id),
  ["codex", "claude", "hermes", "openclaw"],
);

assert.deepEqual(openClawAdapterReport(2), {
  id: "openclaw",
  label: "OpenClaw",
  binary: "openclaw",
  chatSupported: true,
  installed: true,
  path: null,
  version: "2 agents",
  installHint: "Install OpenClaw with `npm install -g openclaw@latest`, then connect or create an agent under ~/.openclaw/agents.",
  source: "openclaw",
  manifestPath: null,
});

assert.equal(openClawAdapterReport(0).installed, false);

const mergedOpenClaw = mergeAdapterReports([openClawAdapterReport(1)], []);
assert.equal(mergedOpenClaw.length, 1);
assert.equal(mergedOpenClaw[0].id, "openclaw");
assert.equal(mergedOpenClaw[0].installed, true);
assert.equal(mergedOpenClaw[0].source, "openclaw");

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

const mergedExternal = mergeAdapterReports(
  [],
  [
    {
      id: "attacker-adapter",
      label: "Attacker Adapter",
      executable: "attacker",
      available: true,
      install_hint: "Do not run this in native chat.",
      source: "manifest",
      manifest_path: "/tmp/attacker.json",
    },
  ],
);
assert.equal(mergedExternal[0]?.chatSupported, false);
assert.equal(mergedExternal[0]?.installed, true);
assert.equal(isTrustedChatHarness("codex"), true);
assert.equal(isTrustedChatHarness("hermes"), true);
assert.equal(isTrustedChatHarness("openclaw"), true);
assert.equal(isTrustedChatHarness("attacker-adapter"), false);
assert.equal(isTrustedOnboardingHarness("openclaw"), true);
assert.equal(isTrustedOnboardingHarness("attacker-adapter"), false);

// canonicalHarnessId collapses package/alias ids and bare binary names back to
// the adapter id, so a familiar bound to "hermes-agent" (the NousResearch repo
// name) is recognized as the trusted "hermes" adapter instead of 403-ing.
assert.equal(canonicalHarnessId("hermes-agent"), "hermes");
assert.equal(canonicalHarnessId("Hermes-Agent"), "hermes", "alias match is case-insensitive");
assert.equal(canonicalHarnessId("claude-code"), "claude");
assert.equal(canonicalHarnessId("hermes"), "hermes", "canonical id passes through");
assert.equal(canonicalHarnessId("HERMES"), "hermes", "id match is case-insensitive");
assert.equal(canonicalHarnessId("attacker-adapter"), "attacker-adapter", "unknown ids are unchanged (still untrusted)");
assert.equal(isTrustedChatHarness("hermes-agent"), true, "the Hermes package alias must clear the chat trust gate");
assert.equal(isTrustedChatHarness("attacker-adapter"), false, "canonicalization must not trust an unknown harness");

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
        "Install Hermes with the official script (github.com/NousResearch/hermes-agent#quick-install), run `hermes setup`, and make sure `hermes` is on PATH before using this adapter.",
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
