// @ts-nocheck
import assert from "node:assert/strict";
import { deriveImplicitScopes, hasImplicitScopes } from "./search-context.ts";

const FAMILIARS = [
  { id: "cody", display_name: "Cody" },
  { id: "val", display_name: "Valentina" },
  { id: "sage", name: "Sage" },
];

// No active context derives no implicit scopes — a bare global search.
{
  const scopes = deriveImplicitScopes({ activeFamiliarId: null });
  assert.deepEqual(scopes, []);
  assert.equal(hasImplicitScopes(scopes), false);
}

// The active familiar becomes a familiar scope with its display label.
{
  const scopes = deriveImplicitScopes({ activeFamiliarId: "cody", familiars: FAMILIARS });
  assert.deepEqual(scopes, [{ dimension: "familiar", id: "cody", label: "Cody", implicit: true }]);
  assert.equal(hasImplicitScopes(scopes), true);
}

// A familiar missing from the roster degrades to its id as the label.
{
  const scopes = deriveImplicitScopes({ activeFamiliarId: "ghost", familiars: FAMILIARS });
  assert.deepEqual(scopes, [{ dimension: "familiar", id: "ghost", label: "ghost", implicit: true }]);
}

// An unnamed familiar falls back to `name`, then to the id.
{
  const scopes = deriveImplicitScopes({ activeFamiliarId: "sage", familiars: FAMILIARS });
  assert.equal(scopes[0].label, "Sage");
}

// Project scope carries the project name, defaulting to the id.
{
  const scopes = deriveImplicitScopes({
    activeFamiliarId: null,
    activeProjectId: "p1",
    activeProjectName: "Psyche Build",
  });
  assert.deepEqual(scopes, [{ dimension: "project", id: "p1", label: "Psyche Build", implicit: true }]);
  const fallback = deriveImplicitScopes({ activeFamiliarId: null, activeProjectId: "p1" });
  assert.equal(fallback[0].label, "p1");
}

// Session and runtime scopes carry their raw ids as labels.
{
  const scopes = deriveImplicitScopes({
    activeFamiliarId: null,
    activeSessionId: "s-42",
    runtime: "codex",
  });
  assert.deepEqual(scopes, [
    { dimension: "session", id: "s-42", label: "s-42", implicit: true },
    { dimension: "runtime", id: "codex", label: "codex", implicit: true },
  ]);
}

// Full workspace state derives all four dimensions in a fixed order:
// project, familiar, session, runtime — deterministic regardless of input
// order, so chips never reorder between renders.
{
  const scopes = deriveImplicitScopes({
    activeFamiliarId: "cody",
    familiars: FAMILIARS,
    activeProjectId: "p1",
    activeProjectName: "Psyche Build",
    activeSessionId: "s-42",
    runtime: "codex",
  });
  assert.deepEqual(scopes.map((scope) => scope.dimension), ["project", "familiar", "session", "runtime"]);
  assert.ok(scopes.every((scope) => scope.implicit));
  // And the same input re-derived is byte-identical (determinism).
  assert.deepEqual(
    deriveImplicitScopes({
      activeFamiliarId: "cody",
      familiars: FAMILIARS,
      activeProjectId: "p1",
      activeProjectName: "Psyche Build",
      activeSessionId: "s-42",
      runtime: "codex",
    }),
    scopes,
  );
}

// Explicit (non-implicit) scopes alone do not count as context.
{
  assert.equal(hasImplicitScopes([{ dimension: "project", id: "p1", label: "P", implicit: false }]), false);
}

// A project id present but empty string derives nothing.
{
  assert.deepEqual(deriveImplicitScopes({ activeFamiliarId: null, activeProjectId: "" }), []);
}

console.log("search-context.test.ts: ok");
