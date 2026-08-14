import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveBundledCopilotPluginDirs } from "./bundled-copilot-plugins.ts";

async function writePlugin(root: string, id: string, extra: Record<string, unknown> = {}) {
  const dir = path.join(root, id);
  await mkdir(path.join(dir, "skills", "recall"), { recursive: true });
  await writeFile(path.join(dir, "skills", "recall", "SKILL.md"), "---\nname: recall\ndescription: Recall.\n---\n");
  await writeFile(path.join(dir, "plugin.json"), JSON.stringify({
    name: id,
    version: "0.1.0",
    description: "Test plugin",
    skills: ["skills/"],
    ...extra,
  }));
  return dir;
}

test("resolves only contained skill-only bundled plugins", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "cave-bundled-plugins-"));
  const valid = await writePlugin(root, "coven-memory");
  await writePlugin(root, "unsafe-hooks", { hooks: "hooks.json" });
  await writePlugin(root, "unsafe-agents", { agents: "agents/" });
  await writePlugin(root, "unsafe-mcp", { mcpServers: ".mcp.json" });
  const outside = await mkdtemp(path.join(tmpdir(), "cave-outside-plugin-"));
  await writePlugin(outside, "escaped");
  try {
    await symlink(path.join(outside, "escaped"), path.join(root, "escaped"), "dir");
  } catch (error) {
    t.diagnostic(`symlink unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }

  assert.deepEqual(
    await resolveBundledCopilotPluginDirs(
      ["coven-memory", "unsafe-hooks", "unsafe-agents", "unsafe-mcp", "escaped", "../invalid"],
      { pluginsRoot: root },
    ),
    [await realpath(valid)],
  );
});

test("resolves generated marketplace skill-only bundles", async () => {
  const root = path.join(process.cwd(), "marketplace", "plugins");
  assert.deepEqual(
    await resolveBundledCopilotPluginDirs(
      ["coven-memory", "tweet-thread-lab"],
      { pluginsRoot: root },
    ),
    [
      await realpath(path.join(root, "coven-memory")),
      await realpath(path.join(root, "tweet-thread-lab")),
    ],
  );
});

test("missing plugin roots degrade to no plugins", async () => {
  assert.deepEqual(
    await resolveBundledCopilotPluginDirs([], { pluginsRoot: "/definitely/missing/cave-plugins" }),
    [],
  );
});
