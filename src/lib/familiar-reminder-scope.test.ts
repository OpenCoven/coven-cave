// @ts-nocheck
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

const caveHome = await mkdtemp(path.join(tmpdir(), "cave-familiar-reminders-"));
process.env.COVEN_CAVE_HOME = caveHome;

const {
  actOnFamiliarReminder,
  createItem,
  deleteFamiliarReminder,
  updateFamiliarReminder,
} = await import("./cave-inbox.ts");

test.after(async () => {
  await rm(caveHome, { recursive: true, force: true });
});

test("scoped reminder mutations cannot cross familiar or item-kind boundaries", async () => {
  const nova = await createItem({
    kind: "reminder",
    familiarId: "nova",
    title: "Nova reminder",
    fireAt: "2026-08-25T12:00:00.000Z",
  });
  const sage = await createItem({
    kind: "reminder",
    familiarId: "sage",
    title: "Sage reminder",
    fireAt: "2026-08-25T13:00:00.000Z",
  });
  const agent = await createItem({
    kind: "agent",
    familiarId: "nova",
    title: "Agent attention",
  });

  assert.equal(await updateFamiliarReminder("nova", sage.id, { title: "stolen" }), null);
  assert.equal(await actOnFamiliarReminder("nova", sage.id, "done"), null);
  assert.equal(await deleteFamiliarReminder("nova", sage.id), false);
  assert.equal(await updateFamiliarReminder("nova", agent.id, { title: "changed" }), null);
  assert.equal(await deleteFamiliarReminder("nova", agent.id), false);

  const updated = await updateFamiliarReminder("nova", nova.id, {
    title: "Updated title",
    body: "Scoped note",
    fireAt: "2026-08-25T14:00:00.000Z",
  });
  assert.equal(updated?.title, "Updated title");
  assert.equal(updated?.familiarId, "nova");
  assert.equal(updated?.kind, "reminder");
  assert.equal(updated?.status, "pending");

  const saved = JSON.parse(await readFile(path.join(caveHome, "inbox.json"), "utf8"));
  assert.equal(saved.items.find((item) => item.id === sage.id).title, "Sage reminder");
  assert.equal(saved.items.find((item) => item.id === agent.id).title, "Agent attention");
});

test("scoped reminder actions preserve ownership", async () => {
  const item = await createItem({
    kind: "reminder",
    familiarId: "nova",
    title: "Act on me",
    fireAt: "2026-08-25T12:00:00.000Z",
  });
  const done = await actOnFamiliarReminder("nova", item.id, "done");
  assert.equal(done?.status, "done");
  assert.equal(done?.familiarId, "nova");
  assert.equal(await deleteFamiliarReminder("nova", item.id), true);
});
