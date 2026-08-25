import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, beforeEach, test } from "node:test";

import {
  categorizeLink,
  deriveLinkTitle,
  savedLinkDedupeKey,
  type SavedLink,
} from "../link-organizer.ts";
import {
  MAX_X_ARTICLE_BODY_CHARS,
  MAX_X_ARTICLE_EXCERPT_CHARS,
  type XArticleSnapshot,
} from "../x-articles.ts";
import type { HfPaperMetadata } from "./hf-paper-metadata.ts";
import { enrichXArticleUrls } from "./x-article-ingest.ts";
import { fetchSorsaXArticle } from "./x-article-sorsa.ts";

const tmp = path.join(import.meta.dirname, `.research-links-test-${randomUUID()}`);
const originalOverride = process.env.CAVE_RESEARCH_LINKS_PATH_OVERRIDE;
process.env.CAVE_RESEARCH_LINKS_PATH_OVERRIDE = path.join(tmp, "research-links.json");

const {
  getSavedLinkById,
  listSavedLinks,
  listSavedLinkSummaries,
  MAX_LINKS_PER_SAVE,
  MAX_SAVED_LINKS,
  removeSavedLink,
  reserveXArticleCandidates,
  saveResearchLinks,
  toSavedLinkSummary,
} = await import("./research-links.ts");

test("saved Research resources retain a 10,000-item searchable catalog", () => {
  assert.equal(MAX_SAVED_LINKS, 10_000);
});

const STORE_PATH = () => process.env.CAVE_RESEARCH_LINKS_PATH_OVERRIDE!;
const ARTICLE_URL = "https://x.com/OpenCoven/status/123456789";
const ARTICLE_WEB_ALIAS_URL = "https://twitter.com/i/web/status/123456789?ref=home";
const ARTICLE_USER_ALIAS_URL = "https://twitter.com/OpenCoven/status/123456789#article";
const ARTICLE_TITLE = "Open Coven reads the room";
const BODY_SENTINEL = "X ARTICLE BODY SENTINEL";
const LEGACY_ARTICLE_URL = "https://example.com/blog/legacy-article";
const VALID_TIMESTAMP = "2026-08-18T12:34:56.000Z";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function makeXArticleSnapshot(overrides: Partial<XArticleSnapshot> = {}): XArticleSnapshot {
  return {
    version: 1,
    provider: "sorsa",
    sourcePostId: "123456789",
    titleSource: "derived",
    author: {
      id: "42",
      username: "opencoven",
      displayName: "Open Coven",
    },
    body: BODY_SENTINEL,
    excerpt: "Lead preview",
    coverImageUrl: "https://cdn.example.com/x-articles/cover.png",
    publishedAt: VALID_TIMESTAMP,
    fetchedAt: "2026-08-18T12:35:10.000Z",
    contentSha256: sha256(BODY_SENTINEL),
    ...overrides,
  };
}

function articleEnrichment(snapshot = makeXArticleSnapshot(), title = ARTICLE_TITLE) {
  return { xArticle: { title, snapshot } };
}

function storedLink(
  patch: Partial<Omit<SavedLink, "paper" | "xArticle">> & { paper?: unknown; xArticle?: unknown } = {},
): Record<string, unknown> {
  return {
    id: "stored-link",
    url: LEGACY_ARTICLE_URL,
    category: "article",
    title: "Stored link",
    addedAt: "2026-08-18T00:00:00.000Z",
    source: "desk",
    ...patch,
  };
}

async function writeStore(file: unknown): Promise<void> {
  await writeFile(STORE_PATH(), JSON.stringify(file, null, 2), "utf8");
}

async function readStoreJson<T>(): Promise<T> {
  return JSON.parse(await readFile(STORE_PATH(), "utf8")) as T;
}

beforeEach(async () => {
  process.env.CAVE_RESEARCH_LINKS_PATH_OVERRIDE = path.join(tmp, "research-links.json");
  await rm(tmp, { recursive: true, force: true });
  await mkdir(tmp, { recursive: true });
});

after(async () => {
  if (originalOverride === undefined) delete process.env.CAVE_RESEARCH_LINKS_PATH_OVERRIDE;
  else process.env.CAVE_RESEARCH_LINKS_PATH_OVERRIDE = originalOverride;
  await rm(tmp, { recursive: true, force: true });
});

test("saving organizes, dedupes, and persists newest-first", async () => {
  const first = await saveResearchLinks(
    ["https://github.com/OpenCoven/coven-cave", "https://arxiv.org/abs/2404.12345"],
    "chat",
  );
  assert.equal(first.added.length, 2);
  assert.equal(first.added[0].category, "github");
  assert.equal(first.added[0].title, "OpenCoven/coven-cave");
  assert.equal(first.added[1].category, "paper");
  assert.equal(first.added[0].source, "chat");

  // Same page in a different spelling → duplicate, not a second row.
  const second = await saveResearchLinks(
    ["https://GITHUB.com/OpenCoven/coven-cave/", "https://example.com/blog/why-we-ship"],
    "desk",
  );
  assert.equal(second.added.length, 1);
  assert.deepEqual(second.duplicates, ["https://GITHUB.com/OpenCoven/coven-cave/"]);
  assert.equal(second.added[0].source, "desk");

  const listed = await listSavedLinks();
  assert.equal(listed.length, 3);

  // The store survives a fresh read from disk (persisted JSON, not memory).
  const onDisk = await readStoreJson<{ version: number; links: unknown[] }>();
  assert.equal(onDisk.version, 1);
  assert.equal(onDisk.links.length, 3);
});

test("invalid inputs are reported, never stored", async () => {
  const result = await saveResearchLinks(
    ["ftp://example.com/file", "not a url", "   ", "javascript:alert(1)"],
    "chat",
  );
  assert.equal(result.added.length, 0);
  assert.deepEqual(result.invalid, ["ftp://example.com/file", "not a url", "javascript:alert(1)"]);
});

test("removal is by id and reports misses", async () => {
  const { added } = await saveResearchLinks(["https://example.com/remove-me"], "desk");
  assert.equal(added.length, 1);
  assert.equal(await removeSavedLink(added[0].id), true);
  assert.equal(await removeSavedLink(added[0].id), false, "second removal is a miss");
  const listed = await listSavedLinks();
  assert.ok(!listed.some((link) => link.id === added[0].id));
});

test("one save is bounded to MAX_LINKS_PER_SAVE", async () => {
  const urls = Array.from({ length: MAX_LINKS_PER_SAVE + 10 }, (_, i) => `https://bulk.example.com/item-${i}`);
  const result = await saveResearchLinks(urls, "desk");
  assert.equal(result.added.length, MAX_LINKS_PER_SAVE);
});

test("persists a valid X Article enrichment with article title, category, and full snapshot", async () => {
  const snapshot = makeXArticleSnapshot();
  const { added } = await saveResearchLinks(
    [ARTICLE_URL],
    "desk",
    new Map([[ARTICLE_URL, articleEnrichment(snapshot)]]),
  );

  assert.equal(added.length, 1);
  assert.equal(added[0].title, ARTICLE_TITLE);
  assert.equal(added[0].category, "article");
  assert.deepEqual(added[0].xArticle, snapshot);

  const listed = await listSavedLinks();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].title, ARTICLE_TITLE);
  assert.equal(listed[0].category, "article");
  assert.deepEqual(listed[0].xArticle, snapshot);
});

test("every accepted Sorsa result persists as an X Article snapshot", async () => {
  const accepted = await fetchSorsaXArticle(ARTICLE_URL, {
    apiKey: "test-only-key",
    now: () => new Date("2026-08-18T12:35:10.000Z"),
    fetchImpl: async () => new Response(JSON.stringify({
      full_text: BODY_SENTINEL,
      preview_text: "Lead preview",
      cover_image_url: "https://cdn.example.com/x-articles/cover.png",
      published_at: VALID_TIMESTAMP,
      author: { id: "42", username: "opencoven", display_name: "Open Coven" },
    }), { status: 200 }),
  });
  const enriched = await enrichXArticleUrls([ARTICLE_URL], new Set(), {
    provider: {
      id: "sorsa",
      fetchArticle: async () => accepted,
    },
  });
  const enrichment = enriched.enrichments.get(ARTICLE_URL);
  assert.ok(enrichment);

  const { added } = await saveResearchLinks(
    [ARTICLE_URL],
    "desk",
    new Map([[ARTICLE_URL, enrichment]]),
  );

  assert.equal(added.length, 1);
  assert.deepEqual(added[0].xArticle, enrichment.xArticle?.snapshot);
  assert.ok((await listSavedLinks())[0]?.xArticle);
});

test("X candidate reservations atomically dedupe aliases and release after failure", async () => {
  const [first, second] = await Promise.all([
    reserveXArticleCandidates([ARTICLE_URL]),
    reserveXArticleCandidates([ARTICLE_WEB_ALIAS_URL]),
  ]);

  assert.deepEqual(first.reservedUrls, [ARTICLE_URL]);
  assert.deepEqual([...first.reservedIdentities], [savedLinkDedupeKey(ARTICLE_URL)]);
  assert.deepEqual(second.reservedUrls, []);
  assert.deepEqual([...second.contendedIdentities], [savedLinkDedupeKey(ARTICLE_URL)]);

  try {
    await assert.rejects(async () => {
      throw new Error("provider failed");
    }, /provider failed/);
  } finally {
    await first.release();
  }
  await second.release();

  const retry = await reserveXArticleCandidates([ARTICLE_WEB_ALIAS_URL]);
  try {
    assert.deepEqual(retry.reservedUrls, [ARTICLE_WEB_ALIAS_URL]);
    assert.deepEqual([...retry.contendedIdentities], []);
  } finally {
    await retry.release();
  }
});

test("saveResearchLinks dedupes X status aliases within one submission", async () => {
  const result = await saveResearchLinks(
    [ARTICLE_URL, ARTICLE_WEB_ALIAS_URL],
    "desk",
  );

  assert.equal(result.added.length, 1);
  assert.deepEqual(result.duplicates, [ARTICLE_WEB_ALIAS_URL]);

  const listed = await listSavedLinks();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].url, ARTICLE_URL);
  assert.equal(listed[0].xArticle, undefined);
});

test("saveResearchLinks dedupes X status aliases against existing provider-neutral saved links", async () => {
  const baseline = await saveResearchLinks([ARTICLE_USER_ALIAS_URL], "desk");
  assert.equal(baseline.added.length, 1);
  assert.equal(baseline.added[0].xArticle, undefined);

  const result = await saveResearchLinks([ARTICLE_URL], "chat");
  assert.equal(result.added.length, 0);
  assert.deepEqual(result.duplicates, [ARTICLE_URL]);

  const listed = await listSavedLinks();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].url, ARTICLE_USER_ALIAS_URL);
  assert.equal(listed[0].xArticle, undefined);
});

test("saveResearchLinks drops xArticle enrichment when the URL source post id does not match", async () => {
  const snapshot = makeXArticleSnapshot({ sourcePostId: "987654321" });
  const { added } = await saveResearchLinks(
    [ARTICLE_URL],
    "desk",
    new Map([[ARTICLE_URL, articleEnrichment(snapshot)]]),
  );

  assert.equal(added.length, 1);
  assert.equal(added[0].xArticle, undefined);
  assert.equal(added[0].category, categorizeLink(ARTICLE_URL));
  assert.equal(added[0].title, deriveLinkTitle(ARTICLE_URL));

  const listed = await listSavedLinks();
  assert.equal(listed[0].xArticle, undefined);
});

test("listSavedLinkSummaries and toSavedLinkSummary omit xArticle bodies without mutating the full record", async () => {
  const snapshot = makeXArticleSnapshot();
  const { added } = await saveResearchLinks(
    [ARTICLE_URL],
    "desk",
    new Map([[ARTICLE_URL, articleEnrichment(snapshot)]]),
  );

  const full = await getSavedLinkById(added[0].id);
  assert.ok(full?.xArticle);
  assert.equal(full.xArticle.body, BODY_SENTINEL);

  const projected = toSavedLinkSummary(full);
  assert.ok(projected.xArticle);
  assert.equal(projected.xArticle.author.displayName, "Open Coven");
  assert.ok(!("body" in projected.xArticle));
  assert.ok(!JSON.stringify(projected).includes(BODY_SENTINEL));

  const listed = await listSavedLinkSummaries();
  assert.equal(listed.length, 1);
  assert.ok(listed[0].xArticle);
  assert.ok(!("body" in listed[0].xArticle!));
  assert.equal(listed[0].xArticle?.contentSha256, snapshot.contentSha256);
  assert.ok(!JSON.stringify(listed).includes(BODY_SENTINEL));

  assert.equal(full.xArticle.body, BODY_SENTINEL, "projection must not mutate the full record");
});

test("getSavedLinkById returns full Article bodies and null for unknown or invalid ids", async () => {
  const { added } = await saveResearchLinks(
    [ARTICLE_URL],
    "desk",
    new Map([[ARTICLE_URL, articleEnrichment()]]),
  );

  const full = await getSavedLinkById(added[0].id);
  assert.ok(full?.xArticle);
  assert.equal(full.xArticle.body, BODY_SENTINEL);
  assert.equal(await getSavedLinkById(""), null);
  assert.equal(await getSavedLinkById(" ".repeat(4)), null);
  assert.equal(await getSavedLinkById("x".repeat(129)), null);
  assert.equal(await getSavedLinkById("missing-id"), null);
});

test("valid X Article snapshots survive a disk reload", async () => {
  const snapshot = makeXArticleSnapshot({
    body: "Reload-safe X Article body",
    contentSha256: sha256("Reload-safe X Article body"),
  });
  await saveResearchLinks(
    [ARTICLE_URL],
    "chat",
    new Map([[ARTICLE_URL, articleEnrichment(snapshot, "Reload-safe title")]]),
  );

  const onDisk = await readStoreJson<{ version: number; links: Array<{ xArticle?: unknown }> }>();
  assert.equal(onDisk.version, 1);
  assert.deepEqual(onDisk.links[0]?.xArticle, snapshot);

  const listed = await listSavedLinks();
  assert.deepEqual(listed[0].xArticle, snapshot);
});

test("an xArticle block with a mismatched body hash is dropped while the base link remains", async () => {
  await writeStore({
    version: 1,
    links: [
      storedLink({
        id: "broken-article",
        title: "Broken article snapshot",
        xArticle: {
          ...makeXArticleSnapshot(),
          body: "Mutated body keeps the old hash",
        },
      }),
    ],
  });

  const listed = await listSavedLinks();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].id, "broken-article");
  assert.equal(listed[0].title, "Broken article snapshot");
  assert.equal(listed[0].category, "article");
  assert.equal(listed[0].xArticle, undefined);
});

test("a valid xArticle block on a non-X URL is dropped while preserving the base category fallback", async () => {
  await writeStore({
    version: 1,
    links: [
      storedLink({
        id: "non-x-article",
        title: "Non-X article snapshot",
        xArticle: makeXArticleSnapshot(),
      }),
    ],
  });

  const listed = await listSavedLinks();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].id, "non-x-article");
  assert.equal(listed[0].title, "Non-X article snapshot");
  assert.equal(listed[0].category, "article");
  assert.equal(listed[0].xArticle, undefined);
});

test("malformed xArticle field groups are dropped during normalization", async () => {
  const tooLongBody = "🧙".repeat(MAX_X_ARTICLE_BODY_CHARS + 1);
  const cases = [
    { name: "version", xArticle: { ...makeXArticleSnapshot(), version: 2 } },
    { name: "provider", xArticle: { ...makeXArticleSnapshot(), provider: "elsewhere" } },
    { name: "sourcePostId", xArticle: { ...makeXArticleSnapshot(), sourcePostId: "not-numeric" } },
    { name: "sourcePostId overlength", xArticle: { ...makeXArticleSnapshot(), sourcePostId: "1".repeat(33) } },
    { name: "titleSource", xArticle: { ...makeXArticleSnapshot(), titleSource: "headline" } },
    { name: "author", xArticle: { ...makeXArticleSnapshot(), author: null } },
    {
      name: "username",
      xArticle: { ...makeXArticleSnapshot(), author: { id: "42", username: "not-valid!" } },
    },
    {
      name: "author id overlength",
      xArticle: { ...makeXArticleSnapshot(), author: { id: "x".repeat(129), username: "opencoven" } },
    },
    {
      name: "displayName overlength",
      xArticle: {
        ...makeXArticleSnapshot(),
        author: { id: "42", username: "opencoven", displayName: "x".repeat(201) },
      },
    },
    { name: "body", xArticle: { ...makeXArticleSnapshot(), body: "   " } },
    {
      name: "body overlength",
      xArticle: {
        ...makeXArticleSnapshot(),
        body: tooLongBody,
        contentSha256: sha256(tooLongBody),
      },
    },
    { name: "excerpt", xArticle: { ...makeXArticleSnapshot(), excerpt: "🧙".repeat(MAX_X_ARTICLE_EXCERPT_CHARS + 1) } },
    { name: "cover URL", xArticle: { ...makeXArticleSnapshot(), coverImageUrl: "ftp://example.com/private.png" } },
    {
      name: "cover URL overlength",
      xArticle: {
        ...makeXArticleSnapshot(),
        coverImageUrl: `https://example.com/${"a".repeat(2100)}`,
      },
    },
    { name: "timestamps", xArticle: { ...makeXArticleSnapshot(), fetchedAt: "2026-99-99T99:99:99Z" } },
    { name: "hash", xArticle: { ...makeXArticleSnapshot(), contentSha256: "A".repeat(64) } },
  ] as const;

  for (const entry of cases) {
    await writeStore({
      version: 1,
      links: [storedLink({ id: entry.name, xArticle: entry.xArticle })],
    });

    const listed = await listSavedLinks();
    assert.equal(listed.length, 1, entry.name);
    assert.equal(listed[0].id, entry.name);
    assert.equal(listed[0].xArticle, undefined, entry.name);
    assert.equal(listed[0].category, "article", entry.name);
  }
});

test("a malformed xArticle block cannot strand an X status URL in the article category", async () => {
  await writeStore({
    version: 1,
    links: [
      storedLink({
        id: "broken-x-status",
        url: ARTICLE_URL,
        category: "article",
        title: "Broken X article",
        xArticle: { ...makeXArticleSnapshot(), provider: "other" },
      }),
    ],
  });

  const listed = await listSavedLinks();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].xArticle, undefined);
  assert.equal(listed[0].category, categorizeLink(ARTICLE_URL));
  assert.equal(listed[0].category, "social");
});

test("legacy links without xArticle still normalize unchanged", async () => {
  await writeStore({
    version: 1,
    links: [
      storedLink({
        id: "legacy-link",
        title: "Legacy article link",
      }),
    ],
  });

  const listed = await listSavedLinks();
  assert.deepEqual(listed, [{
    id: "legacy-link",
    url: LEGACY_ARTICLE_URL,
    category: "article",
    title: "Legacy article link",
    addedAt: "2026-08-18T00:00:00.000Z",
    source: "desk",
  }]);
});

// ── corruption safety (review finding on 972bf1cd) ───────────────────────────

test("a corrupt store file is preserved aside, never silently wiped by a save", async () => {
  const target = STORE_PATH();
  await saveResearchLinks(["https://example.com/pre-corruption"], "desk");
  // Hand-edit the file into invalid JSON (trailing comma).
  const valid = await readFile(target, "utf8");
  await writeFile(target, valid.replace(/\}\s*$/, "},"), "utf8");

  const result = await saveResearchLinks(["https://example.com/post-corruption"], "desk");
  assert.equal(result.added.length, 1);

  // The malformed bytes were snapshotted beside the store before the rewrite.
  const siblings = await readdir(path.dirname(target));
  const backups = siblings.filter((name) => name.includes(".corrupt-"));
  assert.ok(backups.length >= 1, "malformed file preserved as .corrupt-<ts>");
  const backup = await readFile(path.join(path.dirname(target), backups[0]), "utf8");
  assert.match(backup, /pre-corruption/, "the backup holds the pre-corruption content");
});

test("same-millisecond corruption events keep distinct aside captures", async () => {
  const target = STORE_PATH();
  const dir = path.dirname(target);
  await saveResearchLinks(["https://example.com/pre-corruption"], "desk");
  const valid = await readFile(target, "utf8");
  const before = new Set((await readdir(dir)).filter((name) => name.includes(".corrupt-")));

  // Freeze the clock: the aside name's timestamp is millisecond-resolution,
  // so without the random suffix both captures below would target the SAME
  // path and copyFile would clobber the first (see corruptAsidePath).
  const RealDate = Date;
  const frozenMs = new RealDate("2026-01-01T00:00:00.000Z").getTime();
  globalThis.Date = class extends RealDate {
    constructor() {
      super(frozenMs);
    }
  } as DateConstructor;
  try {
    await writeFile(target, "{ corrupt take one", "utf8");
    assert.deepEqual(await listSavedLinks(), [], "a corrupt store reads as empty");
    await writeFile(target, "{ corrupt take two", "utf8");
    assert.deepEqual(await listSavedLinks(), [], "the second corruption also reads as empty");
  } finally {
    globalThis.Date = RealDate;
  }

  const fresh = (await readdir(dir)).filter(
    (name) => name.includes(".corrupt-") && !before.has(name),
  );
  assert.equal(fresh.length, 2, "each corruption event keeps its own capture");
  const captured = await Promise.all(fresh.map((name) => readFile(path.join(dir, name), "utf8")));
  assert.ok(captured.includes("{ corrupt take one"), "the first capture survives");
  assert.ok(captured.includes("{ corrupt take two"), "the second capture survives");

  await writeFile(target, valid, "utf8");
});

test("unreadable stores surface errors instead of reading as empty", async () => {
  const previous = process.env.CAVE_RESEARCH_LINKS_PATH_OVERRIDE;
  // Point the store AT A DIRECTORY: reads fail with EISDIR (not ENOENT).
  process.env.CAVE_RESEARCH_LINKS_PATH_OVERRIDE = tmp;
  try {
    await assert.rejects(() => listSavedLinks(), /EISDIR|illegal operation/i);
    await assert.rejects(() => saveResearchLinks(["https://example.com/x"], "desk"));
  } finally {
    process.env.CAVE_RESEARCH_LINKS_PATH_OVERRIDE = previous;
  }
});

// ── paper metadata (cave-cbz28) ──────────────────────────────────────────────

test("a well-formed paper block survives, a malformed one is dropped without discarding the link", async () => {
  await writeStore({
    version: 1,
    links: [
      storedLink({
        id: "paper-a",
        url: "https://huggingface.co/papers/2401.12345",
        category: "paper",
        title: "A well-formed paper",
        paper: {
          arxivId: "2401.12345",
          authors: ["A. Author"],
          abstract: "An abstract.",
          publishedAt: "2024-01-22T00:00:00.000Z",
        },
      }),
      storedLink({
        id: "paper-b",
        url: "https://huggingface.co/papers/2402.54321",
        category: "paper",
        title: "A malformed paper",
        addedAt: "2026-08-18T00:00:01.000Z",
        paper: {
          arxivId: "../etc/passwd",
          authors: "not-an-array",
        },
      }),
    ],
  });

  const listed = await listSavedLinks();
  const linkA = listed.find((link) => link.id === "paper-a");
  const linkB = listed.find((link) => link.id === "paper-b");

  assert.equal(linkA?.paper?.arxivId, "2401.12345");
  assert.deepEqual(linkA?.paper?.authors, ["A. Author"]);

  assert.ok(linkB, "the link with the malformed paper block still survives");
  assert.equal(linkB?.paper, undefined);
});

// ── saveResearchLinks enrichment parameter (cave-cbz28) ─────────────────────

test("enrichment metadata sets the stored title and paper block", async () => {
  const meta: HfPaperMetadata = {
    title: "A Well-Formed Paper",
    authors: ["A. Author", "B. Author"],
    abstract: "An abstract about a paper.",
    publishedAt: "2024-01-22T00:00:00.000Z",
  };
  const url = "https://huggingface.co/papers/2401.99999";
  const { added } = await saveResearchLinks([url], "desk", new Map([[url, { paper: meta }]]));
  assert.equal(added.length, 1);
  assert.equal(added[0].title, meta.title);
  assert.deepEqual(added[0].paper, {
    arxivId: "2401.99999",
    authors: meta.authors,
    abstract: meta.abstract,
    publishedAt: meta.publishedAt,
  });
});

test("a URL that merely embeds a paper URL never gets a paper block", async () => {
  // The stored arxivId drives the Read affordance and is interpolated into the
  // PDF route's URL, so it has to come from classifying THIS url — not from
  // scanning it for a paper reference that belongs to the page it links to.
  const wrapper = "https://www.google.com/url?q=https://arxiv.org/abs/2401.12345";
  const meta: HfPaperMetadata = {
    title: "Distributionally Robust Receive Beamforming",
    authors: ["A. Author"],
    abstract: "A foreign paper's abstract.",
    publishedAt: "2024-01-22T00:00:00.000Z",
  };
  const { added } = await saveResearchLinks([wrapper], "chat", new Map([[wrapper, { paper: meta }]]));
  assert.equal(added.length, 1);
  assert.equal(added[0].url, wrapper);
  assert.equal(added[0].paper, undefined);
});

test("an empty enrichment entry produces exactly the record saved with no enrichment map at all", async () => {
  const url = "https://huggingface.co/papers/2402.11111";

  const baseline = await saveResearchLinks([url], "desk");
  assert.equal(baseline.added.length, 1);
  assert.equal(await removeSavedLink(baseline.added[0].id), true);

  const withEmptyEnrichment = await saveResearchLinks([url], "desk", new Map([[url, {}]]));
  assert.equal(withEmptyEnrichment.added.length, 1);

  // Same URL, source, title, category, and absence of a paper block — the only
  // fields the map is expected to differ on (id, addedAt) are left uncompared.
  assert.equal(withEmptyEnrichment.added[0].url, baseline.added[0].url);
  assert.equal(withEmptyEnrichment.added[0].title, baseline.added[0].title);
  assert.equal(withEmptyEnrichment.added[0].category, baseline.added[0].category);
  assert.equal(withEmptyEnrichment.added[0].source, baseline.added[0].source);
  assert.equal(withEmptyEnrichment.added[0].paper, baseline.added[0].paper);
  assert.equal(withEmptyEnrichment.added[0].paper, undefined);
});
