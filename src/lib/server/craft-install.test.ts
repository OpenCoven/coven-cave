import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  CODEX_MARKETPLACE_NAME,
  CraftTransactionError,
  craftTransactionStatus,
  craftAffectedRoleDiagnostic,
  createCraftInstallService,
  type CraftCommandRunner,
  type CraftDefinition,
  type CraftInstallStore,
  type CraftInstallationRecord,
} from "./craft-install.ts";

const NOW = "2026-07-09T23:30:00.000Z";
const TARGET = `seekers-lens@${CODEX_MARKETPLACE_NAME}`;

{
  const diagnostics = craftAffectedRoleDiagnostic(
    Array.from({ length: 25 }, (_, index) => ({
      id: `role-${index}`,
      name: index === 0 ? `Bearer secret-token ${"x".repeat(300)}` : `Role ${index}`,
      familiar: `familiar-${index}`,
    })),
    { ...process.env, HOME: "/Users/researcher" },
  );
  assert.equal(diagnostics.affectedRoleCount, 25);
  assert.equal(diagnostics.affectedRoles.length, 20);
  assert.equal(diagnostics.affectedRolesTruncated, true);
  assert.doesNotMatch(JSON.stringify(diagnostics), /secret-token/);
  assert.ok(diagnostics.affectedRoles.every((role) => Object.values(role).every((value) => value.length <= 160)));
}

const craft = {
  id: "seekers-lens",
  displayName: "Seeker's Lens",
  description: "Discovery and ideation for bounded research work.",
  version: "0.1.0",
  craft: {
    schemaVersion: "opencoven.craft.v1",
    components: { required: ["fetch", "filesystem"], optional: ["exa"] },
    bundled: {
      skills: [{
        id: "brainstorming-research-ideas",
        sourcePath: "craft-sources/seekers-lens/brainstorming-research-ideas/SKILL.md",
        upstreamPath: "21-research-ideation/brainstorming-research-ideas/SKILL.md",
        contentHash: "sha256:8422a1a6dc0a88d05f02b9fbe0f8c2ae06a77024856d18125efa13d19d855d46",
        modifications: ["Added Coven execution boundaries."],
      }],
      prompts: [{
        id: "open-a-research-space",
        name: "Open a research space",
        body: "Explore {{topic}} and stop at a checkpoint.",
      }],
      workflows: [{
        id: "diverge-converge-refine",
        name: "Diverge, converge, refine",
        steps: ["Diverge", "Converge", "Stop for review"],
      }],
    },
    requiredCapabilities: ["filesystem.read", "network.http"],
    recommendedRoles: ["researcher", "strategist"],
    provenance: {
      source: "https://github.com/orchestra-research/AI-Research-SKILLs",
      commit: "773a52944ba4747a18bd4ae9ade53fff041adcbc",
      license: "MIT",
      licensePath: "craft-sources/orchestra-research/LICENSE",
    },
  },
  components: {
    fetch: {
      id: "fetch",
      displayName: "Fetch",
      version: "0.1.0",
      kind: "mcp",
      requiredConfig: [],
    },
    filesystem: {
      id: "filesystem",
      displayName: "Filesystem",
      version: "0.1.0",
      kind: "mcp",
      requiredConfig: ["FILESYSTEM_ALLOWED_PATH"],
    },
    exa: {
      id: "exa",
      displayName: "Exa",
      version: "0.1.0",
      kind: "mcp",
      requiredConfig: ["EXA_API_KEY"],
    },
  },
} satisfies CraftDefinition;

type StoreHarness = {
  store: CraftInstallStore;
  entries: Map<string, CraftInstallationRecord>;
  writes: CraftInstallationRecord[];
  removals: string[];
};

function memoryStore(options: { failRecord?: boolean; failRemove?: boolean } = {}): StoreHarness {
  const entries = new Map<string, CraftInstallationRecord>();
  const writes: CraftInstallationRecord[] = [];
  const removals: string[] = [];
  return {
    entries,
    writes,
    removals,
    store: {
      async get(id) {
        return entries.get(id);
      },
      async record(record) {
        if (options.failRecord) throw new Error("disk write failed");
        const saved = { ...record, installedAt: NOW };
        entries.set(record.id, saved);
        writes.push(saved);
        return saved;
      },
      async remove(id) {
        if (options.failRemove) throw new Error("disk delete failed");
        entries.delete(id);
        removals.push(id);
      },
    },
  };
}

function service(
  runner: CraftCommandRunner,
  store: CraftInstallStore,
  codexHome: string,
) {
  return createCraftInstallService({
    runner,
    store,
    catalog: { async get(id) { return id === craft.id ? craft : null; } },
    now: () => NOW,
    env: { NODE_ENV: "test", CODEX_HOME: codexHome, HOME: codexHome },
  });
}

function marketplaceList(configured = true): string {
  return JSON.stringify({
    marketplaces: configured ? [{ name: CODEX_MARKETPLACE_NAME }] : [{ name: "personal" }],
  });
}

function pluginList(installed: boolean, version = craft.version): string {
  return JSON.stringify({
    plugins: installed
      ? [{ name: craft.id, marketplace: CODEX_MARKETPLACE_NAME, version }]
      : [],
  });
}

function commandKey(args: string[]): string {
  return args.join(" ");
}

async function expectTransactionError(
  promise: Promise<unknown>,
  code: CraftTransactionError["code"],
): Promise<CraftTransactionError> {
  try {
    await promise;
    assert.fail(`expected ${code}`);
  } catch (error) {
    assert.ok(error instanceof CraftTransactionError);
    assert.equal(error.code, code);
    return error;
  }
}

const codexHome = await mkdtemp(path.join(os.tmpdir(), "cave-craft-codex-home-"));

try {
  // The plan is read-only and exposes the exact user-scoped transaction,
  // capability footprint, required components, and credentialed enhancements.
  {
    const harness = memoryStore();
    const app = service(async () => assert.fail("plan must not spawn"), harness.store, codexHome);
    const plan = await app.plan(craft.id);
    assert.equal(plan.installTarget, TARGET);
    assert.deepEqual(plan.commands.install, ["codex", "plugin", "add", TARGET, "--json"]);
    assert.deepEqual(plan.commands.verify, ["codex", "plugin", "list", "--json"]);
    assert.deepEqual(plan.components.required.map((entry) => entry.id), ["fetch", "filesystem"]);
    assert.deepEqual(plan.components.optionalEnhancements.map((entry) => entry.id), ["exa"]);
    assert.deepEqual(plan.requiredCapabilities, ["filesystem.read", "network.http"]);
    assert.deepEqual(plan.bundled.skills, ["brainstorming-research-ideas"]);
    assert.equal(plan.provenance.licensePath, "craft-sources/orchestra-research/LICENSE");
    assert.deepEqual(plan.provenance.resources, craft.craft.bundled.skills);
    assert.equal(plan.runtime.scope, "user");
    assert.match(plan.runtime.disclosure, /user scope/i);
    assert.equal(harness.writes.length, 0);
  }

  // Successful installation confirms the marketplace, runs the allowlisted
  // Codex command, verifies the list, and only then persists verified state.
  {
    const harness = memoryStore();
    const calls: Array<{ args: string[]; env: NodeJS.ProcessEnv }> = [];
    let listCount = 0;
    const runner: CraftCommandRunner = async (_command, args, options) => {
      calls.push({ args, env: options.env });
      const key = commandKey(args);
      if (key === "plugin marketplace list --json") return { stdout: marketplaceList(), stderr: "" };
      if (key === "plugin list --json") {
        listCount += 1;
        return { stdout: pluginList(listCount > 1), stderr: "" };
      }
      if (key === `plugin add ${TARGET} --json`) {
        assert.equal(harness.writes.length, 0, "state is not written before verification");
        return { stdout: JSON.stringify({ ok: true, installed: TARGET }), stderr: "" };
      }
      assert.fail(`unexpected command: ${key}`);
    };
    const result = await service(runner, harness.store, codexHome).install(craft.id);
    assert.equal(result.alreadyInstalled, false);
    assert.deepEqual(calls.map(({ args }) => commandKey(args)), [
      "plugin marketplace list --json",
      "plugin list --json",
      `plugin add ${TARGET} --json`,
      "plugin list --json",
    ]);
    assert.ok(calls.every(({ env }) => env.CODEX_HOME === codexHome));
    assert.equal(harness.writes.length, 1);
    assert.deepEqual(harness.writes[0], {
      id: craft.id,
      version: craft.version,
      source: "catalog",
      installedAt: NOW,
      runtime: "codex",
      verifiedAt: NOW,
      craftVersion: craft.version,
    });
  }

  // Modern Codex CLIs report { installed, available } instead of { plugins }
  // and identify entries by pluginId/marketplaceName. Verification must read
  // the installed list (never `available`, which is just the catalog).
  {
    const harness = memoryStore();
    let listCount = 0;
    const modernList = (installed: boolean) => JSON.stringify({
      installed: installed
        ? [{
            pluginId: TARGET,
            name: craft.id,
            marketplaceName: CODEX_MARKETPLACE_NAME,
            version: craft.version,
            installed: true,
            enabled: true,
          }]
        : [],
      available: [{ pluginId: TARGET, name: craft.id, marketplaceName: CODEX_MARKETPLACE_NAME, version: craft.version }],
    });
    const runner: CraftCommandRunner = async (_command, args) => {
      const key = commandKey(args);
      if (key === "plugin marketplace list --json") return { stdout: marketplaceList(), stderr: "" };
      if (key === "plugin list --json") {
        listCount += 1;
        return { stdout: modernList(listCount > 1), stderr: "" };
      }
      if (key === `plugin add ${TARGET} --json`) return { stdout: JSON.stringify({ pluginId: TARGET }), stderr: "" };
      assert.fail(`unexpected command: ${key}`);
    };
    const result = await service(runner, harness.store, codexHome).install(craft.id);
    assert.equal(result.ok, true);
    assert.equal(result.alreadyInstalled, false, "available-only listing must not read as installed");
    assert.equal(harness.writes.length, 1);
  }

  // An install already visible to Codex is adopted without running add.
  {
    const harness = memoryStore();
    const calls: string[] = [];
    const runner: CraftCommandRunner = async (_command, args) => {
      const key = commandKey(args);
      calls.push(key);
      if (key === "plugin marketplace list --json") return { stdout: marketplaceList(), stderr: "" };
      if (key === "plugin list --json") return { stdout: pluginList(true), stderr: "" };
      assert.fail(`unexpected command: ${key}`);
    };
    const result = await service(runner, harness.store, codexHome).install(craft.id);
    assert.equal(result.alreadyInstalled, true);
    assert.equal(calls.some((call) => call.startsWith("plugin add ")), false);
    assert.equal(harness.writes.length, 1, "verified external state is adopted into Cave state");
  }

  // A same-name plugin without marketplace provenance is not sufficient
  // verification for the exact OpenCoven install target.
  {
    const harness = memoryStore();
    let listCount = 0;
    let adds = 0;
    const runner: CraftCommandRunner = async (_command, args) => {
      const key = commandKey(args);
      if (key === "plugin marketplace list --json") return { stdout: marketplaceList(), stderr: "" };
      if (key === "plugin list --json") {
        listCount += 1;
        return {
          stdout: listCount === 1
            ? JSON.stringify({ plugins: [{ name: craft.id, version: craft.version }] })
            : pluginList(true),
          stderr: "",
        };
      }
      if (key === `plugin add ${TARGET} --json`) {
        adds += 1;
        return { stdout: JSON.stringify({ ok: true }), stderr: "" };
      }
      assert.fail(`unexpected command: ${key}`);
    };
    const result = await service(runner, harness.store, codexHome).install(craft.id);
    assert.equal(result.alreadyInstalled, false);
    assert.equal(adds, 1);
  }

  // Marketplace identity without an explicit installed version proves
  // presence, but not that the current Craft version was installed.
  for (const versionless of [
    TARGET,
    { name: craft.id, marketplace: CODEX_MARKETPLACE_NAME },
  ]) {
    const harness = memoryStore();
    let listCount = 0;
    let adds = 0;
    const runner: CraftCommandRunner = async (_command, args) => {
      const key = commandKey(args);
      if (key === "plugin marketplace list --json") return { stdout: marketplaceList(), stderr: "" };
      if (key === "plugin list --json") {
        listCount += 1;
        return {
          stdout: listCount === 1
            ? JSON.stringify({ plugins: [versionless] })
            : pluginList(true),
          stderr: "",
        };
      }
      if (key === `plugin add ${TARGET} --json`) {
        adds += 1;
        return { stdout: JSON.stringify({ ok: true }), stderr: "" };
      }
      assert.fail(`unexpected command: ${key}`);
    };
    const result = await service(runner, harness.store, codexHome).install(craft.id);
    assert.equal(result.alreadyInstalled, false);
    assert.equal(adds, 1);
  }

  // A failed update preserves an already-installed older OpenCoven version;
  // rollback must not delete the user's previous working Craft.
  {
    const harness = memoryStore();
    harness.entries.set(craft.id, {
      id: craft.id,
      version: "0.0.9",
      source: "catalog",
      installedAt: NOW,
      runtime: "codex",
      verifiedAt: NOW,
      craftVersion: "0.0.9",
    });
    const calls: string[] = [];
    const runner: CraftCommandRunner = async (_command, args) => {
      const key = commandKey(args);
      calls.push(key);
      if (key === "plugin marketplace list --json") return { stdout: marketplaceList(), stderr: "" };
      if (key === "plugin list --json") return { stdout: pluginList(true, "0.0.9"), stderr: "" };
      if (key === `plugin add ${TARGET} --json`) {
        throw Object.assign(new Error("update failed"), { code: 1, stderr: "update failed" });
      }
      if (key === `plugin remove ${TARGET} --json`) return { stdout: JSON.stringify({ ok: true }), stderr: "" };
      assert.fail(`unexpected command: ${key}`);
    };
    const error = await expectTransactionError(
      service(runner, harness.store, codexHome).install(craft.id),
      "install_failed",
    );
    assert.equal(calls.includes(`plugin remove ${TARGET} --json`), false);
    assert.equal(error.diagnostic.rollback, undefined);
    assert.equal(harness.entries.get(craft.id)?.craftVersion, "0.0.9");
  }

  // Missing marketplace configuration stops before plugin installation.
  {
    const harness = memoryStore();
    const runner: CraftCommandRunner = async () => ({ stdout: marketplaceList(false), stderr: "" });
    await expectTransactionError(
      service(runner, harness.store, codexHome).install(craft.id),
      "marketplace_not_configured",
    );
    assert.equal(harness.writes.length, 0);
  }

  // Missing CLI and timeouts are classified without leaking subprocess text.
  {
    const harness = memoryStore();
    const missing: CraftCommandRunner = async () => {
      throw Object.assign(new Error("spawn codex ENOENT"), { code: "ENOENT" });
    };
    const error = await expectTransactionError(
      service(missing, harness.store, codexHome).install(craft.id),
      "cli_missing",
    );
    assert.equal(error.diagnostic.step, "marketplace-check");
    assert.equal(harness.writes.length, 0);
  }

  {
    const harness = memoryStore();
    const unsupported: CraftCommandRunner = async () => {
      throw Object.assign(new Error("unsupported plugin command"), {
        code: 2,
        stderr: "error: unrecognized subcommand 'list'\nUsage: codex plugin marketplace <COMMAND>",
      });
    };
    const error = await expectTransactionError(
      service(unsupported, harness.store, codexHome).install(craft.id),
      "unsupported_runtime",
    );
    assert.equal(error.diagnostic.step, "marketplace-check");
    assert.match(error.message, /does not support/i);
  }

  {
    const harness = memoryStore();
    let installed = false;
    const runner: CraftCommandRunner = async (_command, args) => {
      const key = commandKey(args);
      if (key === "plugin marketplace list --json") return { stdout: marketplaceList(), stderr: "" };
      if (key === "plugin list --json") return { stdout: pluginList(installed), stderr: "" };
      if (key === `plugin add ${TARGET} --json`) {
        throw Object.assign(new Error("timed out"), { code: "ETIMEDOUT", killed: true });
      }
      if (key === `plugin remove ${TARGET} --json`) {
        installed = false;
        return { stdout: JSON.stringify({ ok: true }), stderr: "" };
      }
      assert.fail(`unexpected command: ${key}`);
    };
    const error = await expectTransactionError(
      service(runner, harness.store, codexHome).install(craft.id),
      "timeout",
    );
    assert.equal(error.diagnostic.rollback?.attempted, true);
    assert.equal(harness.writes.length, 0);
  }

  // Malformed add JSON and failed post-install verification both roll back a
  // newly attempted install and never persist Cave state.
  {
    const harness = memoryStore();
    const calls: string[] = [];
    const runner: CraftCommandRunner = async (_command, args) => {
      const key = commandKey(args);
      calls.push(key);
      if (key === "plugin marketplace list --json") return { stdout: marketplaceList(), stderr: "" };
      if (key === "plugin list --json") return { stdout: pluginList(false), stderr: "" };
      if (key === `plugin add ${TARGET} --json`) return { stdout: "not-json", stderr: "" };
      if (key === `plugin remove ${TARGET} --json`) return { stdout: JSON.stringify({ ok: true }), stderr: "" };
      assert.fail(`unexpected command: ${key}`);
    };
    const error = await expectTransactionError(
      service(runner, harness.store, codexHome).install(craft.id),
      "malformed_json",
    );
    assert.equal(error.diagnostic.rollback?.succeeded, true);
    assert.ok(calls.includes(`plugin remove ${TARGET} --json`));
    assert.equal(harness.writes.length, 0);
  }

  {
    const harness = memoryStore();
    const calls: string[] = [];
    const runner: CraftCommandRunner = async (_command, args) => {
      const key = commandKey(args);
      calls.push(key);
      if (key === "plugin marketplace list --json") return { stdout: marketplaceList(), stderr: "" };
      if (key === "plugin list --json") return { stdout: pluginList(false), stderr: "" };
      if (key === `plugin add ${TARGET} --json`) return { stdout: JSON.stringify({ ok: true }), stderr: "" };
      if (key === `plugin remove ${TARGET} --json`) return { stdout: JSON.stringify({ ok: true }), stderr: "" };
      assert.fail(`unexpected command: ${key}`);
    };
    const error = await expectTransactionError(
      service(runner, harness.store, codexHome).install(craft.id),
      "verification_failed",
    );
    assert.equal(error.diagnostic.rollback?.succeeded, true);
    assert.equal(harness.writes.length, 0);
  }

  // A persistence failure after successful verification removes the new Codex
  // install and attempts to clear any partial Cave record.
  {
    const harness = memoryStore({ failRecord: true });
    let installed = false;
    const calls: string[] = [];
    const runner: CraftCommandRunner = async (_command, args) => {
      const key = commandKey(args);
      calls.push(key);
      if (key === "plugin marketplace list --json") return { stdout: marketplaceList(), stderr: "" };
      if (key === "plugin list --json") return { stdout: pluginList(installed), stderr: "" };
      if (key === `plugin add ${TARGET} --json`) {
        installed = true;
        return { stdout: JSON.stringify({ ok: true }), stderr: "" };
      }
      if (key === `plugin remove ${TARGET} --json`) {
        installed = false;
        return { stdout: JSON.stringify({ ok: true }), stderr: "" };
      }
      assert.fail(`unexpected command: ${key}`);
    };
    const error = await expectTransactionError(
      service(runner, harness.store, codexHome).install(craft.id),
      "persistence_failed",
    );
    assert.equal(error.diagnostic.rollback?.succeeded, true);
    assert.ok(calls.includes(`plugin remove ${TARGET} --json`));
    assert.deepEqual(harness.removals, [craft.id]);
  }

  {
    const harness = memoryStore({ failRecord: true });
    let installed = false;
    const runner: CraftCommandRunner = async (_command, args) => {
      const key = commandKey(args);
      if (key === "plugin marketplace list --json") return { stdout: marketplaceList(), stderr: "" };
      if (key === "plugin list --json") return { stdout: pluginList(installed), stderr: "" };
      if (key === `plugin add ${TARGET} --json`) {
        installed = true;
        return { stdout: JSON.stringify({ ok: true }), stderr: "" };
      }
      if (key === `plugin remove ${TARGET} --json`) {
        return { stdout: JSON.stringify({ ok: true }), stderr: "" }; // deliberate no-op
      }
      assert.fail(`unexpected command: ${key}`);
    };
    const error = await expectTransactionError(
      service(runner, harness.store, codexHome).install(craft.id),
      "persistence_failed",
    );
    assert.equal(error.diagnostic.rollback?.attempted, true);
    assert.equal(error.diagnostic.rollback?.succeeded, false, "rollback verifies the Craft is absent");
  }

  // A failed rollback list command is a verification failure, not a second
  // removal failure. The original install error remains the transaction code,
  // while the bounded rollback diagnostic identifies the failing phase.
  {
    const harness = memoryStore();
    let listCalls = 0;
    const runner: CraftCommandRunner = async (_command, args) => {
      const key = commandKey(args);
      if (key === "plugin marketplace list --json") return { stdout: marketplaceList(), stderr: "" };
      if (key === "plugin list --json") {
        listCalls += 1;
        if (listCalls === 1) return { stdout: pluginList(false), stderr: "" };
        throw new Error("list failed");
      }
      if (key === `plugin add ${TARGET} --json`) return { stdout: "not-json", stderr: "" };
      if (key === `plugin remove ${TARGET} --json`) return { stdout: JSON.stringify({ ok: true }), stderr: "" };
      assert.fail(`unexpected command: ${key}`);
    };
    const error = await expectTransactionError(
      service(runner, harness.store, codexHome).install(craft.id),
      "malformed_json",
    );
    assert.equal(error.diagnostic.rollback?.succeeded, false);
    assert.match(error.diagnostic.rollback?.message ?? "", /expected Craft installation state/i);
  }

  // Same-Craft concurrent requests serialize; the second observes the verified
  // installation and cannot launch a duplicate add process.
  {
    const harness = memoryStore();
    let installed = false;
    let adds = 0;
    const runner: CraftCommandRunner = async (_command, args) => {
      const key = commandKey(args);
      if (key === "plugin marketplace list --json") return { stdout: marketplaceList(), stderr: "" };
      if (key === "plugin list --json") return { stdout: pluginList(installed), stderr: "" };
      if (key === `plugin add ${TARGET} --json`) {
        adds += 1;
        await new Promise((resolve) => setTimeout(resolve, 10));
        installed = true;
        return { stdout: JSON.stringify({ ok: true }), stderr: "" };
      }
      assert.fail(`unexpected command: ${key}`);
    };
    const app = service(runner, harness.store, codexHome);
    const [first, second] = await Promise.all([app.install(craft.id), app.install(craft.id)]);
    assert.equal(adds, 1);
    assert.deepEqual([first.alreadyInstalled, second.alreadyInstalled], [false, true]);
  }

  // Diagnostics redact credential-shaped output and local home paths, strip
  // ANSI, and remain bounded even when a subprocess is excessively noisy.
  {
    const harness = memoryStore();
    const runner: CraftCommandRunner = async (_command, args) => {
      const key = commandKey(args);
      if (key === "plugin marketplace list --json") return { stdout: marketplaceList(), stderr: "" };
      if (key === "plugin list --json") return { stdout: pluginList(false), stderr: "" };
      if (key === `plugin add ${TARGET} --json`) {
        throw Object.assign(new Error("command failed OPENAI_API_KEY=super-secret"), {
          code: 1,
          stdout: '{"token":"top-secret"}',
          stderr: `\u001b[31mBearer bearer-secret sk-proj-secret ${codexHome}\u001b[0m ${"x".repeat(8_000)}`,
        });
      }
      if (key === `plugin remove ${TARGET} --json`) return { stdout: JSON.stringify({ ok: true }), stderr: "" };
      assert.fail(`unexpected command: ${key}`);
    };
    const error = await expectTransactionError(
      service(runner, harness.store, codexHome).install(craft.id),
      "install_failed",
    );
    const serialized = JSON.stringify(error.diagnostic);
    for (const secret of ["super-secret", "top-secret", "bearer-secret", "sk-proj-secret", codexHome]) {
      assert.equal(serialized.includes(secret), false, `diagnostic redacts ${secret}`);
    }
    assert.match(serialized, /\[REDACTED\]/);
    assert.ok(serialized.length < 7_000, `diagnostic is bounded (${serialized.length})`);
    assert.equal(serialized.includes("\u001b"), false, "ANSI escapes are stripped");
  }

  // Uninstall verifies absence before deleting Cave's record.
  {
    const harness = memoryStore();
    const guarded = createCraftInstallService({
      runner: async () => assert.fail("equipped Craft must be blocked before spawning Codex"),
      store: harness.store,
      catalog: { async get(id) { return id === craft.id ? craft : null; } },
      now: () => NOW,
      env: { NODE_ENV: "test", CODEX_HOME: codexHome, HOME: codexHome },
      beforeUninstall: async () => {
        throw new CraftTransactionError(
          "craft_equipped",
          "Detach this Craft from every Role before removing it.",
          {
            step: "role-check",
            message: "Detach this Craft from every Role before removing it.",
            affectedRoles: [{ id: "researcher", name: "Researcher", familiar: "nova" }],
          },
        );
      },
    });
    const error = await expectTransactionError(guarded.uninstall(craft.id), "craft_equipped");
    assert.equal(craftTransactionStatus(error.code), 409);
    assert.deepEqual(error.diagnostic.affectedRoles, [
      { id: "researcher", name: "Researcher", familiar: "nova" },
    ]);
    assert.deepEqual(harness.removals, []);
  }

  {
    const harness = memoryStore();
    harness.entries.set(craft.id, {
      id: craft.id,
      version: "0.0.9",
      source: "catalog",
      installedAt: NOW,
      runtime: "codex",
      verifiedAt: NOW,
      craftVersion: "0.0.9",
    });
    let installed = true;
    const calls: string[] = [];
    const runner: CraftCommandRunner = async (_command, args) => {
      const key = commandKey(args);
      calls.push(key);
      if (key === "plugin marketplace list --json") return { stdout: marketplaceList(), stderr: "" };
      if (key === "plugin list --json") return { stdout: pluginList(installed, "0.0.9"), stderr: "" };
      if (key === `plugin remove ${TARGET} --json`) {
        installed = false;
        return { stdout: JSON.stringify({ ok: true }), stderr: "" };
      }
      assert.fail(`unexpected command: ${key}`);
    };
    const result = await service(runner, harness.store, codexHome).uninstall(craft.id);
    assert.equal(result.alreadyRemoved, false);
    assert.ok(calls.includes(`plugin remove ${TARGET} --json`));
    assert.deepEqual(harness.removals, [craft.id]);
  }

  {
    const harness = memoryStore();
    harness.entries.set(craft.id, {
      id: craft.id,
      version: craft.version,
      source: "catalog",
      installedAt: NOW,
      runtime: "codex",
      verifiedAt: NOW,
      craftVersion: craft.version,
    });
    let installed = true;
    const calls: string[] = [];
    const runner: CraftCommandRunner = async (_command, args) => {
      const key = commandKey(args);
      calls.push(key);
      if (key === "plugin marketplace list --json") return { stdout: marketplaceList(), stderr: "" };
      if (key === "plugin list --json") return { stdout: pluginList(installed), stderr: "" };
      if (key === `plugin remove ${TARGET} --json`) {
        assert.equal(harness.removals.length, 0, "state remains until absence is verified");
        installed = false;
        return { stdout: JSON.stringify({ ok: true }), stderr: "" };
      }
      assert.fail(`unexpected command: ${key}`);
    };
    const result = await service(runner, harness.store, codexHome).uninstall(craft.id);
    assert.equal(result.alreadyRemoved, false);
    assert.deepEqual(calls, [
      "plugin marketplace list --json",
      "plugin list --json",
      `plugin remove ${TARGET} --json`,
      "plugin list --json",
    ]);
    assert.deepEqual(harness.removals, [craft.id]);
  }

  // Cave state deletion failures retain a stable structured classification
  // whether Codex was already absent or Cave removed and verified it now.
  {
    const harness = memoryStore({ failRemove: true });
    const runner: CraftCommandRunner = async (_command, args) => {
      const key = commandKey(args);
      if (key === "plugin marketplace list --json") return { stdout: marketplaceList(), stderr: "" };
      if (key === "plugin list --json") return { stdout: pluginList(false), stderr: "" };
      assert.fail(`unexpected command: ${key}`);
    };
    const error = await expectTransactionError(
      service(runner, harness.store, codexHome).uninstall(craft.id),
      "persistence_failed",
    );
    assert.equal(error.diagnostic.step, "persist");
  }

  {
    const harness = memoryStore({ failRemove: true });
    let installed = true;
    const runner: CraftCommandRunner = async (_command, args) => {
      const key = commandKey(args);
      if (key === "plugin marketplace list --json") return { stdout: marketplaceList(), stderr: "" };
      if (key === "plugin list --json") return { stdout: pluginList(installed), stderr: "" };
      if (key === `plugin remove ${TARGET} --json`) {
        installed = false;
        return { stdout: JSON.stringify({ ok: true }), stderr: "" };
      }
      assert.fail(`unexpected command: ${key}`);
    };
    const error = await expectTransactionError(
      service(runner, harness.store, codexHome).uninstall(craft.id),
      "persistence_failed",
    );
    assert.equal(error.diagnostic.step, "persist");
  }

  console.log("craft-install.test.ts: ok");
} finally {
  await rm(codexHome, { recursive: true, force: true });
}
