import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readCraftDrafts, saveCraftDraft } from "./craft-drafts.ts";
import { buildCraftDraftFromRoles } from "../craft-draft.ts";

const root = await mkdtemp(path.join(tmpdir(), "cave-craft-drafts-"));

try {
  const draft = buildCraftDraftFromRoles({
    familiar: "sage",
    roles: [
      {
        id: "researcher",
        name: "Researcher",
        familiar: "sage",
        skills: ["research-ingestion"],
        tools: ["read_files", "network"],
        mcpServers: ["fetch"],
        plugins: [],
        workflows: ["bounded-research-cycle"],
        effective: {
          skills: [{ id: "research-ingestion", origin: "direct", originLabel: "Direct" }],
          tools: [
            { id: "read_files", origin: "direct", originLabel: "Direct" },
            { id: "network", origin: "direct", originLabel: "Direct" },
          ],
          mcpServers: [{ id: "fetch", origin: "direct", originLabel: "Direct" }],
          plugins: [],
          workflows: [{ id: "bounded-research-cycle", origin: "direct", originLabel: "Direct" }],
          prompts: [],
          capabilities: [],
        },
      },
    ],
    now: "2026-07-12T09:10:00.000Z",
  });

  await saveCraftDraft(draft, { covenHome: root });
  const drafts = await readCraftDrafts({ covenHome: root });

  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].id, "sage-researcher");
  assert.equal(drafts[0].plugin.draft, true);
  assert.equal(drafts[0].plugin.trust, "local-draft");
  assert.equal(drafts[0].extraction.familiar, "sage");
  assert.deepEqual(drafts[0].plugin.craft?.components.required, ["fetch"]);
  assert.deepEqual(drafts[0].plugin.craft?.requiredCapabilities, ["read_files", "network"]);
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("craft-drafts.test.ts: ok");
