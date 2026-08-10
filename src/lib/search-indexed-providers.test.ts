// @ts-nocheck
import assert from "node:assert/strict";
import {
  corpusFingerprint,
  createCompatibilityProvider,
  createFamiliarsProvider,
  createProjectsProvider,
  createSessionsProvider,
  createTasksProvider,
} from "./search-indexed-providers.ts";
import { normalizeSearchDocument } from "./search-document.ts";
import { createProviderRegistry, providerHonorsQuery } from "./search-provider.ts";

const unrestricted = { allowedProjectIds: null, allowedProjectRoots: null, familiarId: null };
const filter = (key, value) => ({ key, operator: "is", value, origin: "syntax" });

/* ---------------------------------------------------------------------- */
/* Fingerprints                                                            */
/* ---------------------------------------------------------------------- */

// A fingerprint must move whenever any emitted document would, or a refresh
// skips real changes — the store trusts it to decide whether to scan at all.
{
  const a = corpusFingerprint(["p1:alpha", "p2:beta"]);
  assert.equal(a, corpusFingerprint(["p1:alpha", "p2:beta"]), "same corpus, same fingerprint");
  assert.equal(
    a,
    corpusFingerprint(["p2:beta", "p1:alpha"]),
    "source ordering must not read as a change",
  );
  assert.notEqual(a, corpusFingerprint(["p1:alpha", "p2:CHANGED"]), "an edit moves it");
  assert.notEqual(a, corpusFingerprint(["p1:alpha"]), "a removal moves it");
  assert.notEqual(a, corpusFingerprint(["p1:alpha", "p2:beta", "p3:new"]), "an addition moves it");
}

// Each provider's fingerprint moves on a real edit and holds otherwise.
{
  let cards = [{ id: "c1", title: "One", notes: "", status: "open", familiarId: null, sessionId: null, updatedAt: "t1" }];
  const tasks = createTasksProvider({ loadCards: async () => cards });
  const first = await tasks.fingerprint();
  assert.equal(await tasks.fingerprint(), first, "unchanged corpus holds its fingerprint");
  cards = [{ ...cards[0], status: "blocked", updatedAt: "t2" }];
  assert.notEqual(await tasks.fingerprint(), first, "a status change moves the fingerprint");
}

/* ---------------------------------------------------------------------- */
/* Every emitted document must normalize                                   */
/* ---------------------------------------------------------------------- */

const providers = {
  projects: createProjectsProvider({
    loadProjects: async () => [
      { id: "p1", name: "Coven Cave", root: "/repo/cave", repoUrl: "https://github.com/o/r" },
    ],
  }),
  tasks: createTasksProvider({
    loadCards: async () => [
      {
        id: "c1", title: "Rename composer", notes: "long note", status: "blocked",
        familiarId: "cody", sessionId: "s1", projectId: "p1", labels: ["ux"],
        createdAt: "2026-08-01T00:00:00Z", updatedAt: "2026-08-02T00:00:00Z",
      },
    ],
  }),
  sessions: createSessionsProvider({
    listConversations: async () => [
      {
        sessionId: "s1", familiarId: "cody", title: "Composer work", status: "running",
        runtime: "claude", branch: "feat/x", projectId: "p1", updatedAt: "2026-08-02T00:00:00Z",
      },
    ],
  }),
  familiars: createFamiliarsProvider({
    listFamiliars: async () => [
      { id: "cody", display_name: "Cody", description: "coding familiar", familiarType: "coding" },
    ],
  }),
  compatibility: createCompatibilityProvider({
    loadRows: async () => [
      { id: "open-settings", kind: "command", title: "Open settings", href: "/settings" },
      { id: "m1", kind: "memory", title: "A memory row", body: "remembered" },
    ],
  }),
};

for (const [name, provider] of Object.entries(providers)) {
  const raw = await provider.collect(unrestricted);
  assert.ok(raw.length > 0, `${name} emits documents`);
  for (const item of raw) {
    const document = normalizeSearchDocument(item);
    assert.ok(document, `${name}: every emitted document must normalize`);
    assert.equal(document.providerId, provider.id, `${name}: providerId matches the provider`);
    assert.ok(
      provider.entityTypes.includes(document.entityType),
      `${name}: emits only entity types it declares (${document.entityType})`,
    );
    assert.ok(document.sourceVersion.length > 0, `${name}: carries a per-document version`);
    assert.ok(document.action.id.length > 0, `${name}: every result has a primary action`);
  }
}

/* ---------------------------------------------------------------------- */
/* Declared filters must be honest                                         */
/* ---------------------------------------------------------------------- */

// A provider is selected only for filters it can actually honor. Projects have
// no status, so a status query must not select the projects provider — the
// spec's filtered-empty contract rather than silent widening.
{
  const statusQuery = { entityTypes: [], filters: [filter("status", "blocked")] };
  assert.equal(providerHonorsQuery(providers.tasks, statusQuery), true);
  assert.equal(providerHonorsQuery(providers.sessions, statusQuery), true);
  assert.equal(providerHonorsQuery(providers.projects, statusQuery), false);
  assert.equal(providerHonorsQuery(providers.familiars, statusQuery), false);
  assert.equal(providerHonorsQuery(providers.compatibility, statusQuery), false);
}

// The compatibility provider claims only `type`, so a project-scoped query
// cannot select it. It is migration scaffolding, not a general corpus.
{
  const projectQuery = { entityTypes: [], filters: [filter("project", "p1")] };
  assert.equal(providerHonorsQuery(providers.compatibility, projectQuery), false);
  assert.equal(providerHonorsQuery(providers.tasks, projectQuery), true);
}

// Registry: all five coexist with distinct ids.
{
  const registry = createProviderRegistry(Object.values(providers));
  assert.equal(registry.all().length, 5);
  assert.equal(registry.indexed().length, 5, "all five are indexed corpora");
  assert.deepEqual(
    registry.select({ entityTypes: ["task"], filters: [] }).map((p) => p.id),
    ["tasks"],
  );
}

/* ---------------------------------------------------------------------- */
/* Permissions                                                             */
/* ---------------------------------------------------------------------- */

// A project-scoped task is hidden from a requester without that project.
{
  const [card] = await providers.tasks.collect(unrestricted);
  const document = normalizeSearchDocument(card);
  assert.equal(providers.tasks.permits(document, unrestricted), true);
  assert.equal(
    providers.tasks.permits(document, { ...unrestricted, allowedProjectIds: ["other"] }),
    false,
    "a task in an unreadable project is hidden",
  );
}

// A session is familiar-scoped, so it fails closed with no active familiar —
// the leak fixed in the contract, asserted here at the provider level too.
{
  const [conversation] = await providers.sessions.collect(unrestricted);
  const document = normalizeSearchDocument(conversation);
  assert.equal(
    providers.sessions.permits(document, { ...unrestricted, familiarId: null }),
    false,
    "a familiar-scoped session is hidden when no familiar is active",
  );
  assert.equal(
    providers.sessions.permits(document, { allowedProjectIds: ["p1"], allowedProjectRoots: null, familiarId: "cody" }),
    true,
  );
  assert.equal(
    providers.sessions.permits(document, { ...unrestricted, familiarId: "nova" }),
    false,
    "another familiar's session stays hidden",
  );
}

// Familiars are deliberately NOT familiar-scoped: the roster is how you switch
// familiars, so scoping each entry to itself would make every familiar
// invisible from anywhere but inside it.
{
  const [familiar] = await providers.familiars.collect(unrestricted);
  const document = normalizeSearchDocument(familiar);
  assert.deepEqual(document.permissions, []);
  assert.equal(providers.familiars.permits(document, { ...unrestricted, familiarId: "nova" }), true);
}

/* ---------------------------------------------------------------------- */
/* Empty corpora                                                           */
/* ---------------------------------------------------------------------- */

// An empty source is a legitimate state, not an error, and its fingerprint is
// stable so a refresh does not churn.
{
  const empty = createTasksProvider({ loadCards: async () => [] });
  assert.deepEqual(await empty.collect(unrestricted), []);
  assert.equal(await empty.fingerprint(), await empty.fingerprint());
}

// Fingerprints and per-document sourceVersion must move when any emitted document would.
{
  let roster = [
    { id: "cody", display_name: "Cody", description: "coding familiar", familiarType: "coding" },
  ];
  const familiars = createFamiliarsProvider({ listFamiliars: async () => roster });
  const first = await familiars.fingerprint();
  const [before] = await familiars.collect(unrestricted);
  const beforeDoc = normalizeSearchDocument(before);
  assert.ok(beforeDoc);

  roster = [{ ...roster[0], description: "CHANGED" }];
  assert.notEqual(await familiars.fingerprint(), first, "a familiar description edit moves the fingerprint");
  const [after] = await familiars.collect(unrestricted);
  const afterDoc = normalizeSearchDocument(after);
  assert.ok(afterDoc);
  assert.notEqual(afterDoc.sourceVersion, beforeDoc.sourceVersion, "a familiar description edit moves sourceVersion");
}

{
  let rows = [
    { id: "m1", kind: "memory", title: "A memory row", body: "remembered" },
  ];
  const compatibility = createCompatibilityProvider({ loadRows: async () => rows });
  const first = await compatibility.fingerprint();
  const [before] = await compatibility.collect(unrestricted);
  const beforeDoc = normalizeSearchDocument(before);
  assert.ok(beforeDoc);

  rows = [{ ...rows[0], body: "CHANGED" }];
  assert.notEqual(await compatibility.fingerprint(), first, "a compatibility body edit moves the fingerprint");
  const [after] = await compatibility.collect(unrestricted);
  const afterDoc = normalizeSearchDocument(after);
  assert.ok(afterDoc);
  assert.notEqual(afterDoc.sourceVersion, beforeDoc.sourceVersion, "a compatibility body edit moves sourceVersion");
}

console.log("search-indexed-providers.test.ts: ok");
