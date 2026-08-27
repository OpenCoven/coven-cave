import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { savedLinkDedupeKey, type SavedLink } from "../link-organizer.ts";
import type { ResourceManifestV1 } from "../research-resource-contracts.ts";
import {
  listSavedLinks,
  prependSavedLinksAtCap,
  removeSavedLink,
  saveResearchLinks,
} from "./research-links.ts";
import { xArticleContentSha256 } from "./x-article-content-sha.ts";
import {
  listCompatibleResearchLinks,
  mutateCompatibleResearchLinks,
  ResearchLinksCompatibilityError,
} from "./research-links-compatibility.ts";
import {
  researchLinksDigest,
  serializeResearchLinks,
  writeResearchLinksVerified,
} from "./research-links-legacy-store.ts";
import { createResearchResourceStore } from "./research-resource-store.ts";

const NOW = "2026-08-27T21:00:00.000Z";

function link(id: string, overrides: Partial<SavedLink> = {}): SavedLink {
  return {
    id,
    url: `https://example.com/${id}`,
    category: "article",
    title: `Title ${id}`,
    addedAt: "2026-08-27T20:00:00.000Z",
    source: "desk",
    ...overrides,
  };
}

function xLink(): SavedLink {
  const body = "Archived X Article body";
  return link("x-123", {
    url: "https://x.com/OpenCoven/status/123",
    xArticle: {
      version: 1,
      provider: "sorsa",
      sourcePostId: "123",
      titleSource: "provider",
      author: { id: "42", username: "OpenCoven", displayName: "Open Coven" },
      body,
      excerpt: "Archived X Article body",
      publishedAt: "2026-08-27T19:00:00.000Z",
      fetchedAt: "2026-08-27T20:00:00.000Z",
      contentSha256: xArticleContentSha256(body),
    },
  });
}

function deterministicResourceId(legacyId: string): string {
  return `saved-link-${createHash("sha256").update(legacyId).digest("hex").slice(0, 32)}`;
}

function manifestForTest(savedLink: SavedLink): ResourceManifestV1 {
  return {
    version: 1,
    id: deterministicResourceId(savedLink.id),
    revision: 1,
    kind: savedLink.paper ? "paper" : "saved-resource",
    canonicalIdentity: savedLinkDedupeKey(savedLink.url),
    title: savedLink.title,
    sourceUri: savedLink.url,
    sourceType: "saved-link",
    category: savedLink.category,
    legacySavedLink: {
      id: savedLink.id,
      url: savedLink.url,
      addedAt: savedLink.addedAt,
      source: savedLink.source,
    },
    subject: {},
    sensitivity: "public",
    ingest: { desired: false, state: "metadata_only" },
    createdAt: savedLink.addedAt,
    updatedAt: savedLink.addedAt,
  };
}

async function writePreparedJournal(input: {
  resourceRoot: string;
  catalogRevision: number;
  desiredLinks: SavedLink[];
}): Promise<string> {
  const journalPath = path.join(
    input.resourceRoot,
    "migration",
    "research-links-journal.json",
  );
  const intended = serializeResearchLinks({ version: 1, links: input.desiredLinks });
  await writeFile(journalPath, JSON.stringify({
    version: 1,
    catalogRevision: input.catalogRevision,
    intendedProjectionDigest: researchLinksDigest(intended),
    startedAt: NOW,
    phase: "prepared",
    mutationTimestamp: NOW,
    desiredLinks: input.desiredLinks,
  }, null, 2));
  await chmod(journalPath, 0o600);
  return journalPath;
}

async function fixture(
  operation: (input: {
    legacyPath: string;
    resourceRoot: string;
    options: { legacyPath: string; resourceRoot: string; now: () => Date };
  }) => Promise<void>,
): Promise<void> {
  const parent = await mkdtemp(path.join(tmpdir(), "research-links-compatibility-"));
  const legacyPath = path.join(parent, "research-links.json");
  const resourceRoot = path.join(parent, "research-resources");
  try {
    await operation({
      legacyPath,
      resourceRoot,
      options: { legacyPath, resourceRoot, now: () => new Date(NOW) },
    });
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
}

test("first upgrade imports every strict row, preserves X bodies, and verifies a complete projection", async () => {
  await fixture(async ({ legacyPath, resourceRoot, options }) => {
    const initial = [
      link("paper", {
        category: "paper",
        paper: {
          arxivId: "2608.12345",
          authors: ["A. Author"],
          abstract: "A complete abstract.",
          publishedAt: "2026-08-20T00:00:00.000Z",
        },
      }),
      xLink(),
    ];
    await writeResearchLinksVerified({ version: 1, links: initial }, { path: legacyPath });

    const listed = await listCompatibleResearchLinks(options);
    assert.equal(listed.length, 2);
    assert.equal(listed.find((item) => item.id === "x-123")?.xArticle?.body, "Archived X Article body");

    const manifests = await createResearchResourceStore({ root: resourceRoot }).listManifests();
    assert.equal(manifests.length, 2);
    const xManifest = manifests.find((manifest) => manifest.legacySavedLink?.id === "x-123");
    assert.ok(xManifest?.legacySavedLink);
    assert.ok("caveXArticleV1" in xManifest.legacySavedLink);

    const migration = path.join(resourceRoot, "migration");
    const projection = JSON.parse(
      await readFile(path.join(migration, "research-links-projection.json"), "utf8"),
    ) as { catalogRevision: number; projectedDigest: string; rows: unknown[] };
    assert.equal(projection.catalogRevision, 1);
    assert.equal(projection.rows.length, 2);
    assert.equal(
      projection.projectedDigest,
      researchLinksDigest(await readFile(legacyPath)),
    );
    await assert.rejects(
      () => readFile(path.join(migration, "research-links-journal.json")),
      (error) => (error as NodeJS.ErrnoException).code === "ENOENT",
    );
  });
});

test("downgrade-era save and delete reconcile before regeneration without touching catalog-only rows", async () => {
  await fixture(async ({ legacyPath, resourceRoot, options }) => {
    await writeResearchLinksVerified(
      { version: 1, links: [link("keep"), link("delete")] },
      { path: legacyPath },
    );
    await listCompatibleResearchLinks(options);

    const store = createResearchResourceStore({ root: resourceRoot });
    await store.createManifest({
      version: 1,
      id: "catalog-only",
      revision: 1,
      kind: "saved-resource",
      canonicalIdentity: "catalog-only",
      title: "Catalog only",
      sourceType: "test",
      subject: {},
      sensitivity: "private",
      ingest: { desired: false, state: "metadata_only" },
      createdAt: NOW,
      updatedAt: NOW,
    });

    await writeResearchLinksVerified(
      { version: 1, links: [link("keep"), link("added", { addedAt: NOW })] },
      { path: legacyPath },
    );
    const reconciled = await listCompatibleResearchLinks(options);
    assert.deepEqual(reconciled.map((item) => item.id), ["added", "keep"]);
    const manifests = await store.listManifests();
    assert.ok(manifests.some((manifest) => manifest.id === "catalog-only"));
    assert.ok(!manifests.some((manifest) => manifest.legacySavedLink?.id === "delete"));
    assert.ok(manifests.some((manifest) => manifest.legacySavedLink?.id === "added"));
  });
});

test("a prepared journal replays its complete desired set before serving reads", async () => {
  await fixture(async ({ legacyPath, resourceRoot, options }) => {
    await writeResearchLinksVerified({ version: 1, links: [link("base")] }, { path: legacyPath });
    await listCompatibleResearchLinks(options);

    const desired = [link("base"), link("journaled", { addedAt: NOW })];
    const journalPath = await writePreparedJournal({
      resourceRoot,
      catalogRevision: 2,
      desiredLinks: desired,
    });

    const recovered = await listCompatibleResearchLinks(options);
    assert.deepEqual(recovered.map((item) => item.id), ["journaled", "base"]);
    assert.ok(
      (await createResearchResourceStore({ root: resourceRoot }).listManifests())
        .some((manifest) => manifest.legacySavedLink?.id === "journaled"),
    );
    await assert.rejects(
      () => readFile(journalPath),
      (error) => (error as NodeJS.ErrnoException).code === "ENOENT",
    );
  });
});

test("a catalog-side deletion is not resurrected when the downgrade row also changed", async () => {
  await fixture(async ({ legacyPath, resourceRoot, options }) => {
    const original = link("dual-delete");
    await writeResearchLinksVerified({ version: 1, links: [original] }, { path: legacyPath });
    await listCompatibleResearchLinks(options);

    const store = createResearchResourceStore({ root: resourceRoot });
    const manifest = await store.readManifest(deterministicResourceId(original.id));
    assert.ok(manifest);
    await store.withManifestCatalogTransaction((catalog) =>
      catalog.deleteCompatibilityManifest(manifest));
    await writeResearchLinksVerified(
      { version: 1, links: [{ ...original, title: "Downgrade edit" }] },
      { path: legacyPath },
    );

    assert.deepEqual(await listCompatibleResearchLinks(options), []);
    assert.deepEqual(
      JSON.parse(await readFile(legacyPath, "utf8")),
      { version: 1, links: [] },
    );
    assert.equal(await store.readManifest(manifest.id), null);
  });
});

test("a conflicting downgrade edit against an ingested manifest fails closed", async () => {
  await fixture(async ({ legacyPath, resourceRoot, options }) => {
    const original = link("ingested-conflict");
    await writeResearchLinksVerified({ version: 1, links: [original] }, { path: legacyPath });
    await listCompatibleResearchLinks(options);

    const store = createResearchResourceStore({ root: resourceRoot });
    const manifest = await store.readManifest(deterministicResourceId(original.id));
    assert.ok(manifest);
    const ingested: ResourceManifestV1 = {
      ...manifest,
      revision: manifest.revision + 1,
      title: "Catalog edit",
      ingest: { desired: false, state: "partial" },
      updatedAt: NOW,
    };
    await store.updateManifest({
      id: manifest.id,
      expectedRevision: manifest.revision,
      manifest: ingested,
    });
    await writeResearchLinksVerified(
      { version: 1, links: [{ ...original, title: "Downgrade edit" }] },
      { path: legacyPath },
    );
    const legacyBefore = await readFile(legacyPath);

    await assert.rejects(
      () => listCompatibleResearchLinks(options),
      (error) => error instanceof ResearchLinksCompatibilityError
        && /entered ingestion/.test(error.message),
    );
    assert.deepEqual(await readFile(legacyPath), legacyBefore);
    assert.deepEqual(await store.readManifest(manifest.id), ingested);
  });
});

test("a matching legacy id on a non-deterministic manifest id is rejected", async () => {
  await fixture(async ({ legacyPath, resourceRoot, options }) => {
    const original = link("wrong-owner");
    await writeResearchLinksVerified({ version: 1, links: [original] }, { path: legacyPath });
    const foreignOwner: ResourceManifestV1 = {
      version: 1,
      id: "non-deterministic-owner",
      revision: 1,
      kind: "saved-resource",
      canonicalIdentity: original.url,
      title: original.title,
      sourceUri: original.url,
      sourceType: "saved-link",
      category: original.category,
      legacySavedLink: {
        id: original.id,
        url: original.url,
        addedAt: original.addedAt,
        source: original.source,
      },
      subject: {},
      sensitivity: "public",
      ingest: { desired: false, state: "metadata_only" },
      createdAt: original.addedAt,
      updatedAt: original.addedAt,
    };
    const store = createResearchResourceStore({ root: resourceRoot });
    await store.createManifest(foreignOwner);

    await assert.rejects(
      () => listCompatibleResearchLinks(options),
      (error) => error instanceof ResearchLinksCompatibilityError
        && /non-deterministic resource manifest/.test(error.message),
    );
    assert.deepEqual(await store.listManifests(), [foreignOwner]);
  });
});

test("an absent legacy row cannot delete a non-deterministic manifest owner", async () => {
  await fixture(async ({ legacyPath, resourceRoot, options }) => {
    await writeResearchLinksVerified({ version: 1, links: [] }, { path: legacyPath });
    const original = link("foreign-delete-owner");
    const foreignOwner: ResourceManifestV1 = {
      version: 1,
      id: "non-deterministic-delete-owner",
      revision: 1,
      kind: "saved-resource",
      canonicalIdentity: original.url,
      title: original.title,
      sourceUri: original.url,
      sourceType: "saved-link",
      category: original.category,
      legacySavedLink: {
        id: original.id,
        url: original.url,
        addedAt: original.addedAt,
        source: original.source,
      },
      subject: {},
      sensitivity: "public",
      ingest: { desired: false, state: "metadata_only" },
      createdAt: original.addedAt,
      updatedAt: original.addedAt,
    };
    const store = createResearchResourceStore({ root: resourceRoot });
    await store.createManifest(foreignOwner);

    await assert.rejects(
      () => listCompatibleResearchLinks(options),
      (error) => error instanceof ResearchLinksCompatibilityError
        && /non-deterministic resource manifest/.test(error.message),
    );
    assert.deepEqual(await store.listManifests(), [foreignOwner]);
  });
});

test("a journal older than the verified projection revision is rejected", async () => {
  await fixture(async ({ legacyPath, resourceRoot, options }) => {
    const original = link("stale-journal");
    await writeResearchLinksVerified({ version: 1, links: [original] }, { path: legacyPath });
    await listCompatibleResearchLinks(options);
    const legacyBefore = await readFile(legacyPath);
    await writePreparedJournal({ resourceRoot, catalogRevision: 0, desiredLinks: [original] });

    await assert.rejects(
      () => listCompatibleResearchLinks(options),
      (error) => error instanceof ResearchLinksCompatibilityError
        && /journal revision is stale/.test(error.message),
    );
    assert.deepEqual(await readFile(legacyPath), legacyBefore);
  });
});

test("a mutating call recovers a prepared journal before applying its requested mutation", async () => {
  await fixture(async ({ legacyPath, resourceRoot, options }) => {
    const base = link("base");
    await writeResearchLinksVerified({ version: 1, links: [base] }, { path: legacyPath });
    await listCompatibleResearchLinks(options);
    const journalPath = await writePreparedJournal({
      resourceRoot,
      catalogRevision: 2,
      desiredLinks: [base, link("journaled", { addedAt: NOW })],
    });

    let callbackIds: string[] = [];
    const result = await mutateCompatibleResearchLinks((links) => {
      callbackIds = links.map((item) => item.id);
      return {
        links: [link("requested", { addedAt: NOW }), ...links],
        result: "requested mutation committed",
      };
    }, options);

    assert.equal(result, "requested mutation committed");
    assert.deepEqual(callbackIds, ["journaled", "base"]);
    assert.deepEqual(
      (await listCompatibleResearchLinks(options)).map((item) => item.id),
      ["journaled", "requested", "base"],
    );
    const projection = JSON.parse(
      await readFile(path.join(resourceRoot, "migration", "research-links-projection.json"), "utf8"),
    ) as { catalogRevision: number };
    assert.equal(projection.catalogRevision, 3);
    await assert.rejects(
      () => readFile(journalPath),
      (error) => (error as NodeJS.ErrnoException).code === "ENOENT",
    );
  });
});

test("compatibility mutation returns only after catalog and projection converge", async () => {
  await fixture(async ({ legacyPath, resourceRoot, options }) => {
    const result = await mutateCompatibleResearchLinks(
      (links) => ({ links: [link("new"), ...links], result: "committed" }),
      options,
    );
    assert.equal(result, "committed");
    assert.equal(
      (await listCompatibleResearchLinks(options))[0]?.id,
      "new",
    );
    assert.match(await readFile(legacyPath, "utf8"), /"id": "new"/);
    assert.ok(
      (await createResearchResourceStore({ root: resourceRoot }).listManifests())
        .some((manifest) => manifest.legacySavedLink?.id === "new"),
    );
  });
});

test("bounded eviction converges catalog and projection and preflight refuses an ingested victim atomically", async () => {
  await fixture(async ({ legacyPath, resourceRoot, options }) => {
    const initial = [
      link("newest", { addedAt: "2026-08-27T20:00:00.000Z" }),
      link("middle", { addedAt: "2026-08-27T19:00:00.000Z" }),
      link("oldest", { addedAt: "2026-08-27T18:00:00.000Z" }),
    ];
    await writeResearchLinksVerified({ version: 1, links: initial }, { path: legacyPath });
    await listCompatibleResearchLinks(options);

    const first = link("first", { addedAt: "2026-08-27T21:00:00.000Z" });
    await mutateCompatibleResearchLinks((links) => ({
      links: prependSavedLinksAtCap([first], links, 3),
      result: undefined,
    }), options);

    const projected = await listCompatibleResearchLinks(options);
    assert.deepEqual(projected.map((item) => item.id), ["first", "newest", "middle"]);
    assert.deepEqual(
      (JSON.parse(await readFile(legacyPath, "utf8")) as { links: SavedLink[] }).links
        .map((item) => item.id),
      ["first", "newest", "middle"],
    );
    const store = createResearchResourceStore({ root: resourceRoot });
    assert.deepEqual(
      (await store.listManifests())
        .filter((manifest) => manifest.legacySavedLink)
        .map((manifest) => manifest.legacySavedLink!.id)
        .sort(),
      ["first", "middle", "newest"],
    );

    const victim = await store.readManifest(deterministicResourceId("middle"));
    assert.ok(victim);
    await store.updateManifest({
      id: victim.id,
      expectedRevision: victim.revision,
      manifest: {
        ...victim,
        revision: victim.revision + 1,
        ingest: { desired: false, state: "partial" },
        updatedAt: NOW,
      },
    });
    const legacyBefore = await readFile(legacyPath);
    const catalogBefore = await store.listManifests();
    const refused = link("refused", { addedAt: "2026-08-27T22:00:00.000Z" });

    await assert.rejects(
      () => mutateCompatibleResearchLinks((links) => ({
        links: prependSavedLinksAtCap([refused], links, 3),
        result: undefined,
      }), options),
      /metadata-only resources/,
    );
    assert.deepEqual(await readFile(legacyPath), legacyBefore);
    assert.deepEqual(await store.listManifests(), catalogBefore);
    await assert.rejects(
      () => readFile(path.join(resourceRoot, "migration", "research-links-journal.json")),
      (error) => (error as NodeJS.ErrnoException).code === "ENOENT",
    );
  });
});

test("saved-link list, save, delete, and prepared-journal recovery ignore the Resource UI flag", async () => {
  const originalFlag = process.env.NEXT_PUBLIC_CAVE_RESEARCH_RESOURCES;
  const originalLegacy = process.env.CAVE_RESEARCH_LINKS_PATH_OVERRIDE;
  const originalResources = process.env.CAVE_RESEARCH_RESOURCES_PATH_OVERRIDE;
  try {
    for (const flag of ["0", "1"]) {
      await fixture(async ({ legacyPath, resourceRoot }) => {
        process.env.NEXT_PUBLIC_CAVE_RESEARCH_RESOURCES = flag;
        process.env.CAVE_RESEARCH_LINKS_PATH_OVERRIDE = legacyPath;
        process.env.CAVE_RESEARCH_RESOURCES_PATH_OVERRIDE = resourceRoot;
        const base = link(`base-${flag}`);
        await writeResearchLinksVerified({ version: 1, links: [base] }, { path: legacyPath });
        assert.deepEqual((await listSavedLinks()).map((item) => item.id), [base.id]);

        const journaled = link(`journaled-${flag}`, { addedAt: NOW });
        await writePreparedJournal({
          resourceRoot,
          catalogRevision: 2,
          desiredLinks: [base, journaled],
        });
        assert.deepEqual(
          (await listSavedLinks()).map((item) => item.id),
          [journaled.id, base.id],
        );

        const savedUrl = `https://example.com/saved-while-flag-${flag}`;
        const saved = await saveResearchLinks([savedUrl], "desk");
        assert.equal(saved.added.length, 1);
        assert.equal(await removeSavedLink(base.id), true);
        assert.deepEqual(
          new Set((await listSavedLinks()).map((item) => item.id)),
          new Set([journaled.id, saved.added[0].id]),
        );
      });
    }
  } finally {
    if (originalFlag === undefined) delete process.env.NEXT_PUBLIC_CAVE_RESEARCH_RESOURCES;
    else process.env.NEXT_PUBLIC_CAVE_RESEARCH_RESOURCES = originalFlag;
    if (originalLegacy === undefined) delete process.env.CAVE_RESEARCH_LINKS_PATH_OVERRIDE;
    else process.env.CAVE_RESEARCH_LINKS_PATH_OVERRIDE = originalLegacy;
    if (originalResources === undefined) delete process.env.CAVE_RESEARCH_RESOURCES_PATH_OVERRIDE;
    else process.env.CAVE_RESEARCH_RESOURCES_PATH_OVERRIDE = originalResources;
  }
});

test("three-way reconciliation unions disjoint legacy and catalog additions, edits, and deletes", async () => {
  await fixture(async ({ legacyPath, resourceRoot, options }) => {
    const base = [
      link("stable"),
      link("legacy-edit"),
      link("catalog-edit"),
      link("legacy-delete"),
      link("catalog-delete"),
    ];
    await writeResearchLinksVerified({ version: 1, links: base }, { path: legacyPath });
    await listCompatibleResearchLinks(options);

    const store = createResearchResourceStore({ root: resourceRoot });
    const catalogAddition = link("catalog-add", { addedAt: NOW });
    await store.createManifest(manifestForTest(catalogAddition));
    const catalogEdit = await store.readManifest(deterministicResourceId("catalog-edit"));
    assert.ok(catalogEdit);
    await store.updateManifest({
      id: catalogEdit.id,
      expectedRevision: catalogEdit.revision,
      manifest: {
        ...catalogEdit,
        revision: catalogEdit.revision + 1,
        title: "Catalog won its disjoint edit",
        updatedAt: NOW,
      },
    });
    const catalogDelete = await store.readManifest(deterministicResourceId("catalog-delete"));
    assert.ok(catalogDelete);
    await store.withManifestCatalogTransaction((catalog) =>
      catalog.deleteCompatibilityManifest(catalogDelete));

    const legacyAddition = link("legacy-add", { addedAt: "2026-08-27T20:30:00.000Z" });
    await writeResearchLinksVerified({
      version: 1,
      links: [
        base[0],
        { ...base[1], title: "Legacy won its disjoint edit" },
        base[2],
        base[4],
        legacyAddition,
      ],
    }, { path: legacyPath });

    const reconciled = await listCompatibleResearchLinks(options);
    assert.deepEqual(
      new Set(reconciled.map((item) => item.id)),
      new Set(["stable", "legacy-edit", "catalog-edit", "legacy-add", "catalog-add"]),
    );
    assert.equal(
      reconciled.find((item) => item.id === "legacy-edit")?.title,
      "Legacy won its disjoint edit",
    );
    assert.equal(
      reconciled.find((item) => item.id === "catalog-edit")?.title,
      "Catalog won its disjoint edit",
    );
    assert.deepEqual(
      new Set(
        (JSON.parse(await readFile(legacyPath, "utf8")) as { links: SavedLink[] }).links
          .map((item) => item.id),
      ),
      new Set(reconciled.map((item) => item.id)),
    );
  });
});

test("corrupt projection metadata fails closed without overwriting the legacy file", async () => {
  await fixture(async ({ legacyPath, resourceRoot, options }) => {
    await writeResearchLinksVerified({ version: 1, links: [link("safe")] }, { path: legacyPath });
    await listCompatibleResearchLinks(options);
    const before = await readFile(legacyPath);
    const projection = path.join(resourceRoot, "migration", "research-links-projection.json");
    await writeFile(projection, "{ broken");
    await chmod(projection, 0o600);

    await assert.rejects(
      () => listCompatibleResearchLinks(options),
      (error) => error instanceof ResearchLinksCompatibilityError,
    );
    assert.deepEqual(await readFile(legacyPath), before);
  });
});

test("semantically equal noncanonical legacy bytes are rewritten to the exact verified projection", async () => {
  await fixture(async ({ legacyPath, resourceRoot, options }) => {
    const original = link("noncanonical-bytes");
    await writeResearchLinksVerified({ version: 1, links: [original] }, { path: legacyPath });
    await listCompatibleResearchLinks(options);

    await writeFile(legacyPath, `${JSON.stringify({ version: 1, links: [original] })}\n`);
    await chmod(legacyPath, 0o600);
    await listCompatibleResearchLinks(options);

    const projected = serializeResearchLinks({ version: 1, links: [original] });
    assert.deepEqual(await readFile(legacyPath), Buffer.from(projected));
    const metadata = JSON.parse(
      await readFile(path.join(resourceRoot, "migration", "research-links-projection.json"), "utf8"),
    ) as { projectedDigest: string; catalogRevision: number };
    assert.equal(metadata.projectedDigest, researchLinksDigest(await readFile(legacyPath)));
    assert.equal(metadata.catalogRevision, 1);
  });
});
