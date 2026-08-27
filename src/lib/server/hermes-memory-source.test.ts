import assert from "node:assert/strict";
import test from "node:test";
import { hermesMemorySourceForBinding } from "./hermes-memory-source.ts";

test("resolves bare local Hermes familiars to the default Hermes home", () => {
  assert.deepEqual(
    hermesMemorySourceForBinding(
      "cody",
      { harness: "hermes", model: "", runtime: { kind: "local" } },
      "/home/cave",
    ),
    {
      ok: true,
      familiarId: "cody",
      hermesHome: "/home/cave/.hermes",
    },
  );
});

test("keeps profile, remote, and non-Hermes familiar sources isolated", () => {
  assert.deepEqual(
    hermesMemorySourceForBinding("research", {
      harness: "hermes",
      model: "",
      runtime: { kind: "local" },
      hermesProfile: {
        id: "research",
        homePath: "/home/cave/.hermes/profiles/research",
      },
    }),
    {
      ok: true,
      familiarId: "research",
      hermesHome: "/home/cave/.hermes/profiles/research",
    },
  );
  assert.deepEqual(
    hermesMemorySourceForBinding("remote", {
      harness: "hermes",
      model: "",
      runtime: { kind: "ssh", host: "example", cwd: "/work", command: "coven" },
    }),
    { ok: false, error: "remote-unavailable" },
  );
  assert.deepEqual(
    hermesMemorySourceForBinding("codex", {
      harness: "codex",
      model: "",
      runtime: { kind: "local" },
    }),
    { ok: false, error: "not-hermes" },
  );
});
