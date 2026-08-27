import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import type { SavedLink } from "../link-organizer.ts";
import {
  listCompatibleResearchLinks,
  type ResearchLinksCompatibilityFailpoint,
} from "./research-links-compatibility.ts";
import {
  readResearchLinksStrict,
  writeResearchLinksVerified,
} from "./research-links-legacy-store.ts";
import { createResearchResourceStore } from "./research-resource-store.ts";

const execFileAsync = promisify(execFile);
const NOW = "2026-08-27T22:00:00.000Z";

function link(id: string): SavedLink {
  return {
    id,
    url: `https://example.com/${id}`,
    category: "article",
    title: `Title ${id}`,
    addedAt: NOW,
    source: "desk",
  };
}

async function fixture(
  operation: (input: {
    legacyPath: string;
    resourceRoot: string;
    options: { legacyPath: string; resourceRoot: string; now: () => Date };
  }) => Promise<void>,
): Promise<void> {
  const parent = await mkdtemp(path.join(tmpdir(), "research-links-crash-"));
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

function pointName(point: ResearchLinksCompatibilityFailpoint): string {
  return point.kind === "manifest-mutated" ? `${point.kind}-${point.index}` : point.kind;
}

const crashPoints: ResearchLinksCompatibilityFailpoint[] = [
  { kind: "prepared-published" },
  { kind: "manifest-mutated", index: 0, operation: "create" },
  { kind: "manifest-mutated", index: 1, operation: "create" },
  { kind: "manifest-mutated", index: 2, operation: "create" },
  { kind: "committed-published" },
  { kind: "before-legacy-projection" },
  { kind: "legacy-projection-verified" },
  { kind: "metadata-published" },
  { kind: "journal-removed" },
];

for (const crashPoint of crashPoints) {
  test(`recovery converges idempotently after ${pointName(crashPoint)}`, async () => {
    await fixture(async ({ legacyPath, resourceRoot, options }) => {
      const desired = [link("a"), link("b"), link("c")];
      await writeResearchLinksVerified({ version: 1, links: desired }, { path: legacyPath });
      let injected = false;
      await assert.rejects(
        () => listCompatibleResearchLinks({
          ...options,
          testFailpoint: (point) => {
            if (!injected && pointName(point) === pointName(crashPoint)) {
              injected = true;
              throw new Error(`injected crash at ${pointName(point)}`);
            }
          },
        }),
        /injected crash/,
      );
      assert.equal(injected, true);

      const first = await listCompatibleResearchLinks(options);
      assert.deepEqual(first.map((item) => item.id), ["a", "b", "c"]);
      const store = createResearchResourceStore({ root: resourceRoot });
      const firstManifests = await store.listManifests();
      assert.deepEqual(
        firstManifests.map((manifest) => manifest.legacySavedLink?.id).sort(),
        ["a", "b", "c"],
      );
      const migration = path.join(resourceRoot, "migration");
      const projectionPath = path.join(migration, "research-links-projection.json");
      const firstLegacyBytes = await readFile(legacyPath);
      const firstMetadataBytes = await readFile(projectionPath);
      await assert.rejects(
        () => readFile(path.join(migration, "research-links-journal.json")),
        (error) => (error as NodeJS.ErrnoException).code === "ENOENT",
      );

      const second = await listCompatibleResearchLinks(options);
      assert.deepEqual(second, first);
      assert.deepEqual(await store.listManifests(), firstManifests);
      assert.deepEqual(await readFile(legacyPath), firstLegacyBytes);
      assert.deepEqual(await readFile(projectionPath), firstMetadataBytes);
    });
  });
}

const childModule = new URL("./research-links.ts", import.meta.url).href;
const childScript = `
  const input = JSON.parse(process.env.RESEARCH_LINKS_CHILD_INPUT);
  process.env.CAVE_RESEARCH_LINKS_PATH_OVERRIDE = input.legacyPath;
  process.env.CAVE_RESEARCH_RESOURCES_PATH_OVERRIDE = input.resourceRoot;
  const api = await import(${JSON.stringify(childModule)});
  if (input.operation === "list") {
    await api.listSavedLinks();
  } else if (input.operation === "save") {
    await api.saveResearchLinks([input.url], "desk");
  } else if (input.operation === "delete") {
    await api.removeSavedLink(input.id);
  }
`;

async function runChild(input: {
  legacyPath: string;
  resourceRoot: string;
  operation: "list" | "save" | "delete";
  id?: string;
  url?: string;
}): Promise<void> {
  await execFileAsync(
    process.execPath,
    ["--experimental-strip-types", "--input-type=module", "-e", childScript],
    {
      env: {
        ...process.env,
        RESEARCH_LINKS_CHILD_INPUT: JSON.stringify(input),
      },
      maxBuffer: 1024 * 1024,
    },
  );
}

test("child processes serialize concurrent first import", async () => {
  await fixture(async ({ legacyPath, resourceRoot, options }) => {
    await writeResearchLinksVerified(
      { version: 1, links: [link("first-a"), link("first-b")] },
      { path: legacyPath },
    );
    await Promise.all([
      runChild({ legacyPath, resourceRoot, operation: "list" }),
      runChild({ legacyPath, resourceRoot, operation: "list" }),
    ]);
    assert.deepEqual(
      (await listCompatibleResearchLinks(options)).map((item) => item.id),
      ["first-a", "first-b"],
    );
  });
});

test("child processes serialize save/save without losing either update", async () => {
  await fixture(async ({ legacyPath, resourceRoot, options }) => {
    await listCompatibleResearchLinks(options);
    await Promise.all([
      runChild({ legacyPath, resourceRoot, operation: "save", url: "https://example.com/save-a" }),
      runChild({ legacyPath, resourceRoot, operation: "save", url: "https://example.com/save-b" }),
    ]);
    assert.deepEqual(
      (await readResearchLinksStrict({ path: legacyPath })).links.map((item) => item.url).sort(),
      ["https://example.com/save-a", "https://example.com/save-b"],
    );
  });
});

test("child processes serialize save/delete without resurrecting or losing updates", async () => {
  await fixture(async ({ legacyPath, resourceRoot, options }) => {
    await writeResearchLinksVerified(
      { version: 1, links: [link("delete-me"), link("keep")] },
      { path: legacyPath },
    );
    await listCompatibleResearchLinks(options);
    await Promise.all([
      runChild({ legacyPath, resourceRoot, operation: "save", url: "https://example.com/added" }),
      runChild({ legacyPath, resourceRoot, operation: "delete", id: "delete-me" }),
    ]);
    const final = await listCompatibleResearchLinks(options);
    assert.equal(final.some((item) => item.id === "delete-me"), false);
    assert.equal(final.some((item) => item.id === "keep"), true);
    assert.equal(final.some((item) => item.url === "https://example.com/added"), true);
  });
});
