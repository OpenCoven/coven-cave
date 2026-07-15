// @ts-nocheck
import { test } from "node:test";
import assert from "node:assert/strict";
import { familiarBrainProvider } from "./familiar-brain.ts";

test("mintSession grants a keyless familiar-brain session bound to the chat session", async () => {
  const grant = await familiarBrainProvider.mintSession("", {
    familiarId: "milo",
    model: "",
    voice: "Samantha",
    instructions: "unused — the harness carries its own identity",
    sessionId: "sess-42",
  });
  assert.equal(grant.provider, "familiar");
  assert.equal(grant.clientSecret, "familiar");
  assert.equal(grant.connection.kind, "familiar-brain");
  assert.equal(grant.connection.familiarId, "milo");
  assert.equal(grant.connection.sessionId, "sess-42");
  assert.equal(grant.connection.voice, "Samantha");
  // The hydrated impression-mode payload must NOT ride the grant — the real
  // conversation lives server-side and the chat bridge owns the context.
  assert.equal("instructions" in grant.connection, false);
  assert.equal("conversationSeed" in grant.connection, false);
});

test("mintSession rejects without a session to attach to", async () => {
  await assert.rejects(
    () => familiarBrainProvider.mintSession("", {
      familiarId: "milo",
      model: "",
      voice: "",
      instructions: "",
    }),
    /familiar_brain_missing_session/,
  );
});

test("the provider persists its own transcripts (real chat turns)", () => {
  assert.equal(familiarBrainProvider.persistsTranscripts, true);
  assert.equal(familiarBrainProvider.id, "familiar");
  assert.equal(typeof familiarBrainProvider.clientAdapter.connect, "function");
});
