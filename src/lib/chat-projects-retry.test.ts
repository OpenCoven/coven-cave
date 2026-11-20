import assert from "node:assert/strict";
import { test } from "node:test";
import { createProjectsRetryCarry } from "./chat-projects-retry.ts";

const target = { familiarId: "nova", chatId: "chat-a" };
const payload = { text: "evidence", attachments: [{ name: "evidence.txt", data: "ZXZpZGVuY2U=" }], controls: { permissionMode: "full" } };

test("Projects preserves the original failed payload on repeated mounts of its chat", () => {
  const carry = createProjectsRetryCarry<typeof payload>();
  carry.save(target, payload);
  assert.deepEqual(carry.returnTo(target), payload);
  assert.deepEqual(carry.returnTo(target), payload);
});

for (const other of [{ familiarId: "nova", chatId: "chat-b" }, { familiarId: "sage", chatId: "chat-a" }]) {
  test(`opening ${other.familiarId}/${other.chatId} drops the carry permanently`, () => {
    const carry = createProjectsRetryCarry<typeof payload>();
    carry.save(target, payload);
    assert.equal(carry.returnTo(other), null);
    assert.equal(carry.returnTo(target), null);
  });
}

test("a new send or dismiss releases the payload, and a fresh runtime never restores it", () => {
  const carry = createProjectsRetryCarry<typeof payload>();
  carry.save(target, payload);
  assert.equal(createProjectsRetryCarry<typeof payload>().returnTo(target), null);
  carry.drop();
  assert.equal(carry.returnTo(target), null);
});


test("a passive pane cannot consume or discard another chat’s Projects return", () => {
  const carry = createProjectsRetryCarry<typeof payload>();
  carry.save(target, payload);
  assert.equal(carry.read({ familiarId: "sage", chatId: "split-b" }), null);
  assert.deepEqual(carry.returnTo(target), payload);
});
