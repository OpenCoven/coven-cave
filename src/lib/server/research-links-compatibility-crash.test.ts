import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
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

// Pause real filesystem scheduling in each child, never production lock logic.
// The second contender either enters (the old missing-choosing defect) or
// starts its second admission scan (the corrected waiting path). No sleep
// determines which schedule is exercised.
const controlledTransactionScript = `
  import fs from "node:fs/promises";
  import path from "node:path";
  import { syncBuiltinESMExports } from "node:module";
  const input = JSON.parse(process.env.RESEARCH_LINKS_CHILD_INPUT);
  const pending = new Set();
  const waiters = new Map();
  process.on("message", (message) => {
    const resolve = waiters.get(message);
    if (resolve) { waiters.delete(message); resolve(); }
    else pending.add(message);
  });
  const wait = (message) => pending.delete(message) ? Promise.resolve()
    : new Promise((resolve) => waiters.set(message, resolve));
  const intents = path.join(input.resourceRoot, "locks", "intents");
  const originalOpen = fs.open;
  const originalReaddir = fs.readdir;
  let published = false;
  let scans = 0;
  fs.open = async (...args) => {
    const target = String(args[0]);
    const isIntent = path.dirname(target) === intents && target.endsWith(".lock");
    if (isIntent && input.role === "a" && !published) {
      process.send({ event: "publication-held" });
      await wait("publish");
    }
    const handle = await originalOpen(...args);
    if (isIntent) published = true;
    return handle;
  };
  fs.readdir = async (...args) => {
    if (input.role === "b" && published && String(args[0]) === intents && ++scans === 2) {
      process.send({ event: "waiting" });
      await wait("resume-scan");
    }
    return originalReaddir(...args);
  };
  syncBuiltinESMExports();
  try {
    const { mutateCompatibleResearchLinks } = await import(${JSON.stringify(new URL("./research-links-compatibility.ts", import.meta.url).href)});
    await mutateCompatibleResearchLinks(async (links) => {
      process.send({ event: "entered", urls: links.map((item) => item.url) });
      await wait("write");
      return { links: [...links, {
        id: input.role, url: "https://example.com/save-" + input.role,
        category: "article", title: input.role, addedAt: ${JSON.stringify(NOW)}, source: "desk",
      }], result: null };
    }, { legacyPath: input.legacyPath, resourceRoot: input.resourceRoot });
    process.send({ event: "done" });
  } catch (error) {
    process.send({ event: "error", message: String(error) });
    process.exitCode = 1;
  } finally {
    process.disconnect();
  }
`;

test("delayed intent publication serializes real child transactions before legacy projection", { timeout: 30_000 }, async (t) => {
  await fixture(async ({ legacyPath, resourceRoot, options }) => {
    await listCompatibleResearchLinks(options);
    type Message = { event: string; urls?: string[]; message?: string };
    const children: ReturnType<typeof startChild>[] = [];
    function startChild(role: "a" | "b") {
      t.signal.throwIfAborted();
      const process = spawn(globalThis.process.execPath,
        ["--experimental-strip-types", "--input-type=module", "-e", controlledTransactionScript], {
          env: { ...globalThis.process.env, RESEARCH_LINKS_CHILD_INPUT: JSON.stringify({ role, legacyPath, resourceRoot }) },
          stdio: ["ignore", "pipe", "pipe", "ipc"],
        });
      const messages: Message[] = [];
      let stderr = "";
      let notify = () => {};
      let closed = false;
      process.stderr?.on("data", (chunk) => { stderr += String(chunk); });
      process.stdout?.resume();
      process.on("message", (message) => { messages.push(message as Message); notify(); });
      const exited = new Promise<void>((resolve) => process.once("close", () => { closed = true; notify(); resolve(); }));
      process.on("error", (error) => { messages.push({ event: "error", message: String(error) }); notify(); });
      async function until(...events: string[]): Promise<Message> {
        const deadline = Date.now() + 10_000;
        for (;;) {
          const error = messages.find((message) => message.event === "error");
          assert.equal(error, undefined, JSON.stringify(error));
          const result = messages.find((message) => events.includes(message.event));
          if (result) return result;
          assert.equal(closed, false, `child ${role} exited before ${events}: ${stderr}`);
          const remaining = deadline - Date.now();
          assert.ok(remaining > 0, `child ${role} timed out waiting for ${events}: ${stderr}`);
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, remaining);
            notify = () => { clearTimeout(timer); resolve(); };
          });
        }
      }
      return { process, until, exited, isClosed: () => closed };
    }
    const stopChildren = () => {
      for (const child of children) if (!child.isClosed()) child.process.kill("SIGKILL");
    };
    t.signal.addEventListener("abort", stopChildren, { once: true });
    try {
      const a = startChild("a"); children.push(a);
      await a.until("publication-held");
      const b = startChild("b"); children.push(b);
      const admission = await b.until("entered", "waiting");
      a.process.send("publish");
      await a.until("entered");
      if (admission.event === "entered") {
        // Preserve the old failing ordering so the projection assertion below
        // catches a genuinely lost row rather than merely an early admission.
        b.process.send("write"); await b.until("done");
        a.process.send("write"); await a.until("done");
      } else {
        a.process.send("write"); await a.until("done");
        b.process.send("resume-scan"); await b.until("entered");
        b.process.send("write"); await b.until("done");
      }
      await Promise.all(children.map((child) => child.exited));
      // A compatibility list can recover the lost projection from manifests.
      // Read the raw legacy file FIRST, matching the original CI failure.
      assert.deepEqual((await readResearchLinksStrict({ path: legacyPath })).links.map((item) => item.url).sort(),
        ["https://example.com/save-a", "https://example.com/save-b"]);
      assert.equal(admission.event, "waiting", "a live chooser must prevent early admission");
      assert.deepEqual((await b.until("entered")).urls, ["https://example.com/save-a"]);
    } finally {
      stopChildren();
      await Promise.all(children.map((child) => child.exited));
      t.signal.removeEventListener("abort", stopChildren);
    }
  });
});
