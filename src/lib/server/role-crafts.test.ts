import assert from "node:assert/strict";
import {
  RoleCraftServiceError,
  createRoleCraftService,
  type RoleCraftServiceOptions,
} from "./role-crafts.ts";
import type { CraftDefinition } from "./craft-install.ts";
import type { InstalledMap } from "../marketplace-catalog.ts";
import { parseRoleListField } from "../role-manifest.ts";
import { createKeyedTransactionLock } from "./keyed-transaction-lock.ts";

const NOW = "2026-07-10T01:00:00.000Z";

const seekersLens = {
  id: "seekers-lens",
  displayName: "Seeker's Lens",
  description: "Discovery and ideation.",
  version: "0.1.0",
  craft: {
    schemaVersion: "opencoven.craft.v1",
    components: { required: ["filesystem", "fetch"], optional: ["exa"] },
    bundled: {
      skills: [{
        id: "brainstorming-research-ideas",
        sourcePath: "skills/brainstorming-research-ideas/SKILL.md",
        upstreamPath: "upstream/SKILL.md",
        contentHash: `sha256:${"a".repeat(64)}`,
        modifications: [],
      }],
      prompts: [{ id: "open-a-research-space", name: "Open", body: "Open {{topic}}" }],
      workflows: [{ id: "diverge-converge-refine", name: "Diverge", steps: ["Diverge"] }],
    },
    requiredCapabilities: ["network.http", "filesystem.read"],
    recommendedRoles: ["researcher"],
    provenance: {
      source: "https://github.com/orchestra-research/AI-Research-SKILLs",
      commit: "773a52944ba4747a18bd4ae9ade53fff041adcbc",
      license: "MIT",
      licensePath: "LICENSE",
    },
  },
  components: {
    filesystem: { id: "filesystem", displayName: "Filesystem", version: "1.0.0", kind: "mcp", requiredConfig: [] },
    fetch: { id: "fetch", displayName: "Fetch", version: "1.0.0", kind: "mcp", requiredConfig: [] },
    exa: { id: "exa", displayName: "Exa", version: "1.0.0", kind: "mcp", requiredConfig: ["EXA_API_KEY"] },
  },
} satisfies CraftDefinition;

const direct = {
  skills: ["direct-skill"],
  tools: ["shell"],
  mcpServers: ["filesystem"],
  plugins: [],
  workflows: [],
};

const roleDocs = new Map([
  ["/roles/nova/researcher/ROLE.md", `---\nname: "Researcher"\nfamiliar: nova\n---\n\n# Researcher\n\nskills:\n- direct-skill\n`],
  ["/roles/sage/analyst/ROLE.md", `---\nname: "Analyst"\nfamiliar: sage\n---\n\n# Analyst\n\ncrafts:\n- seekers-lens\n`],
]);
const roleFiles = [
  { id: "researcher", familiar: "nova", path: "/roles/nova/researcher/ROLE.md" },
  { id: "analyst", familiar: "sage", path: "/roles/sage/analyst/ROLE.md" },
];

let installed: InstalledMap = {};
const writes: Array<{ path: string; text: string }> = [];
const options = {
  listRoleFiles: async () => roleFiles,
  readRole: async (path) => roleDocs.get(path) ?? "",
  writeRole: async (path, text) => {
    roleDocs.set(path, text);
    writes.push({ path, text });
  },
  loadCraft: async (id) => id === seekersLens.id ? seekersLens : null,
  installedCrafts: async () => installed,
} satisfies RoleCraftServiceOptions;
const service = createRoleCraftService(options);

function verified(version = seekersLens.version): InstalledMap {
  return {
    [seekersLens.id]: {
      version,
      source: "catalog",
      installedAt: NOW,
      runtime: "codex",
      verifiedAt: NOW,
      craftVersion: version,
    },
  };
}

async function expectRoleCraftError(
  promise: Promise<unknown>,
  code: RoleCraftServiceError["code"],
): Promise<RoleCraftServiceError> {
  try {
    await promise;
    assert.fail(`expected ${code}`);
  } catch (error) {
    assert.ok(error instanceof RoleCraftServiceError);
    assert.equal(error.code, code);
    return error;
  }
}

// Only an exact verified Codex Craft contributes effective capabilities.
installed = verified();
const ready = await service.resolve(direct, [seekersLens.id], installed);
assert.deepEqual(ready.craftStates, [{
  id: seekersLens.id,
  displayName: seekersLens.displayName,
  version: seekersLens.version,
  status: "ready",
}]);
assert.equal(
  ready.effective.skills.find((entry) => entry.id === "brainstorming-research-ideas")?.originLabel,
  "via Seeker's Lens",
);
assert.equal(ready.effective.mcpServers.filter((entry) => entry.id === "filesystem").length, 1);

const missing = await service.resolve(direct, ["missing-craft"], {});
assert.deepEqual(missing.craftStates, [{ id: "missing-craft", status: "missing" }]);
assert.equal(missing.effective.skills.some((entry) => entry.origin === "craft"), false);

for (const [state, status] of [
  [{}, "not-installed"],
  [{ [seekersLens.id]: { version: "0.1.0", source: "catalog", installedAt: NOW } }, "not-installed"],
  [verified("0.0.9"), "update-required"],
] as const) {
  const result = await service.resolve(direct, [seekersLens.id], state as InstalledMap);
  assert.equal(result.craftStates[0]?.status, status);
  assert.equal(result.effective.skills.some((entry) => entry.origin === "craft"), false);
}

// Attach requires a current verified install, writes the canonical crafts:
// list, preserves legacy direct fields, and is idempotent.
installed = verified();
writes.length = 0;
const attached = await service.attach({
  roleId: "researcher",
  familiar: "nova",
  craftId: seekersLens.id,
  attach: true,
});
assert.deepEqual(attached.crafts, [seekersLens.id]);
assert.match(roleDocs.get(roleFiles[0].path) ?? "", /crafts:\n- seekers-lens/);
assert.match(roleDocs.get(roleFiles[0].path) ?? "", /skills:\n- direct-skill/);
await service.attach({ roleId: "researcher", familiar: "nova", craftId: seekersLens.id, attach: true });
assert.equal(writes.length, 1, "idempotent attach does not rewrite ROLE.md");

installed = {};
await expectRoleCraftError(
  service.attach({ roleId: "researcher", familiar: "nova", craftId: seekersLens.id, attach: true }),
  "craft_not_installed",
);
installed = verified("0.0.9");
await expectRoleCraftError(
  service.attach({ roleId: "researcher", familiar: "nova", craftId: seekersLens.id, attach: true }),
  "craft_update_required",
);
await expectRoleCraftError(
  service.attach({ roleId: "researcher", familiar: "nova", craftId: "missing-craft", attach: true }),
  "craft_not_found",
);

// Detach is always available as recovery, even when a Craft is stale or gone.
const detached = await service.attach({
  roleId: "researcher",
  familiar: "nova",
  craftId: seekersLens.id,
  attach: false,
});
assert.deepEqual(detached.crafts, []);
assert.doesNotMatch(roleDocs.get(roleFiles[0].path) ?? "", /crafts:/);

await expectRoleCraftError(
  service.attach({ roleId: "../escape", familiar: "nova", craftId: seekersLens.id, attach: false }),
  "unsafe_id",
);
await expectRoleCraftError(
  service.attach({ roleId: "missing", familiar: "nova", craftId: seekersLens.id, attach: false }),
  "role_not_found",
);

const affected = await service.attachments(seekersLens.id);
assert.deepEqual(affected, [{ id: "analyst", name: "Analyst", familiar: "sage" }]);

const unreadable = createRoleCraftService({
  ...options,
  readRole: async () => { throw new Error("role unreadable"); },
});
await assert.rejects(
  unreadable.attachments(seekersLens.id),
  /role unreadable/,
  "unreadable Role state blocks removal instead of failing open",
);

// Updates to one ROLE.md are serialized, so two different Craft attaches
// cannot both read the same manifest and silently overwrite one another.
{
  const docs = new Map([[roleFiles[0].path, roleDocs.get(roleFiles[0].path) ?? ""]]);
  let readCount = 0;
  let releaseFirstRead!: () => void;
  let markFirstRead!: () => void;
  const firstRead = new Promise<void>((resolve) => { markFirstRead = resolve; });
  const release = new Promise<void>((resolve) => { releaseFirstRead = resolve; });
  const secondCraft = { ...seekersLens, id: "archivists-index", displayName: "Archivist's Index" };
  const concurrentService = createRoleCraftService({
    ...options,
    listRoleFiles: async () => [roleFiles[0]],
    readRole: async (path) => {
      readCount += 1;
      if (readCount === 1) {
        markFirstRead();
        await release;
      }
      return docs.get(path) ?? "";
    },
    writeRole: async (path, text) => { docs.set(path, text); },
    loadCraft: async (id) => id === seekersLens.id ? seekersLens : id === secondCraft.id ? secondCraft : null,
    installedCrafts: async () => ({
      ...verified(),
      [secondCraft.id]: {
        version: secondCraft.version,
        source: "catalog",
        installedAt: NOW,
        runtime: "codex",
        verifiedAt: NOW,
        craftVersion: secondCraft.version,
      },
    }),
    withRoleTransaction: createKeyedTransactionLock(),
  });

  const first = concurrentService.attach({ roleId: "researcher", familiar: "nova", craftId: seekersLens.id, attach: true });
  await firstRead;
  const second = concurrentService.attach({ roleId: "researcher", familiar: "nova", craftId: secondCraft.id, attach: true });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(readCount, 1, "second Role update waits for the first read-modify-write");
  releaseFirstRead();
  await Promise.all([first, second]);
  assert.deepEqual(parseRoleListField(docs.get(roleFiles[0].path) ?? "", "crafts"), [seekersLens.id, secondCraft.id]);
}

// The same per-Craft lock is injectable into Role edits and install/remove
// transactions, preventing an uninstall check from passing mid-attach.
{
  const craftTransaction = createKeyedTransactionLock();
  let releaseRead!: () => void;
  let markRead!: () => void;
  const readStarted = new Promise<void>((resolve) => { markRead = resolve; });
  const release = new Promise<void>((resolve) => { releaseRead = resolve; });
  const lockedService = createRoleCraftService({
    ...options,
    listRoleFiles: async () => [roleFiles[0]],
    readRole: async (path) => {
      markRead();
      await release;
      return roleDocs.get(path) ?? "";
    },
    withCraftTransaction: craftTransaction,
  });

  installed = verified();
  const attaching = lockedService.attach({ roleId: "researcher", familiar: "nova", craftId: seekersLens.id, attach: true });
  await readStarted;
  let uninstallEntered = false;
  const uninstalling = craftTransaction(seekersLens.id, async () => { uninstallEntered = true; });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(uninstallEntered, false, "uninstall waits until the Role attachment commits");
  releaseRead();
  await Promise.all([attaching, uninstalling]);
  assert.equal(uninstallEntered, true);
}

console.log("role-crafts.test.ts: ok");
