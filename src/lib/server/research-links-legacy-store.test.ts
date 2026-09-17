import assert from "node:assert/strict";
import {
  chmod,
  link,
  lstat,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import type { SavedLink } from "../link-organizer.ts";
import { xArticleContentSha256 } from "./x-article-content-sha.ts";
import {
  MAX_RESEARCH_LINKS_FILE_BYTES,
  ResearchLinksLegacyStoreError,
  parseResearchLinksBytes,
  readResearchLinksStrict,
  researchLinksDigest,
  serializeResearchLinks,
  validateAndDetachSavedLink,
  writeResearchLinksVerified,
} from "./research-links-legacy-store.ts";

function regularLink(overrides: Partial<SavedLink> = {}): SavedLink {
  return {
    id: "link-1",
    url: "https://example.com/article",
    category: "article",
    title: "Example article",
    addedAt: "2026-08-27T12:00:00.000Z",
    source: "desk",
    ...overrides,
  };
}

function xLink(): SavedLink {
  const body = "A complete archived article body.";
  return regularLink({
    id: "x-123",
    url: "https://x.com/OpenCoven/status/123",
    title: "Archived post",
    xArticle: {
      version: 1,
      provider: "sorsa",
      sourcePostId: "123",
      titleSource: "provider",
      author: { id: "author-1", username: "OpenCoven", displayName: "Open Coven" },
      body,
      excerpt: "A complete archived article body.",
      coverImageUrl: "https://example.com/cover.png",
      publishedAt: "2026-08-26T12:00:00.000Z",
      fetchedAt: "2026-08-27T12:00:00.000Z",
      contentSha256: xArticleContentSha256(body),
    },
  });
}

function githubLink(): SavedLink {
  return regularLink({
    id: "github-1",
    url: "https://github.com/OpenCoven/coven-cave",
    category: "github",
    title: "OpenCoven/coven-cave",
    githubRepo: {
      version: 1,
      owner: "OpenCoven",
      repo: "coven-cave",
      description: "Desktop control room",
      primaryLanguage: "TypeScript",
      licenseSpdx: "MIT",
      visibility: "public",
      stars: 42,
      forks: 7,
      defaultBranch: "main",
      resolvedRef: "main",
      commitSha: "a".repeat(40),
      fetchedAt: "2026-09-01T12:00:00.000Z",
      truncated: false,
      tree: [{ path: "README.md", type: "blob", sha: "b".repeat(40), size: 5 }],
      readme: { path: "README.md", markdown: "# Cave" },
    },
  });
}

function bytes(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(value), "utf8");
}

function invalidFile(message: RegExp): (error: unknown) => boolean {
  return (error) => error instanceof ResearchLinksLegacyStoreError
    && error.code === "invalid-file"
    && message.test(error.message);
}

test("strict parser accepts and deeply detaches complete saved-link rows", () => {
  const source = {
    version: 1,
    links: [
      regularLink({
        id: "paper-1",
        category: "paper",
        paper: {
          arxivId: "2608.12345",
          authors: ["Ada Lovelace"],
          abstract: "A bounded abstract.",
          publishedAt: "2026-08-26T00:00:00.000Z",
        },
      }),
      xLink(),
      githubLink(),
    ],
  };
  const parsed = parseResearchLinksBytes(bytes(source));
  assert.deepEqual(parsed, source);
  source.links[0]!.title = "mutated";
  source.links[0]!.paper!.authors[0] = "mutated";
  source.links[1]!.xArticle!.author.username = "mutated";
  source.links[2]!.githubRepo!.tree[0]!.path = "mutated";
  source.links[2]!.githubRepo!.readme!.markdown = "mutated";
  assert.equal(parsed.links[0]!.title, "Example article");
  assert.equal(parsed.links[0]!.paper!.authors[0], "Ada Lovelace");
  assert.equal(parsed.links[1]!.xArticle!.author.username, "OpenCoven");
  assert.equal(parsed.links[2]!.githubRepo!.tree[0]!.path, "README.md");
  assert.equal(parsed.links[2]!.githubRepo!.readme!.markdown, "# Cave");
});

test("serializer is deterministic, pretty-printed, newline-free, and hashes exact bytes", () => {
  const file = { version: 1 as const, links: [regularLink()] };
  const first = serializeResearchLinks(file);
  const second = serializeResearchLinks(file);
  assert.deepEqual(first, second);
  assert.equal(Buffer.from(first).toString("utf8"), JSON.stringify(file, null, 2));
  assert.equal(first.at(-1), "}".charCodeAt(0));
  assert.match(researchLinksDigest(first), /^[a-f0-9]{64}$/);
});

test("rejects malformed envelopes, invalid UTF-8, excess rows, and oversized bytes", () => {
  assert.throws(() => parseResearchLinksBytes(bytes({ version: 2, links: [] })), invalidFile(/envelope/));
  assert.throws(
    () => parseResearchLinksBytes(bytes({ version: 1, links: [], extra: true })),
    invalidFile(/envelope/),
  );
  assert.throws(
    () => parseResearchLinksBytes(Uint8Array.from([0xc3, 0x28])),
    (error) => error instanceof ResearchLinksLegacyStoreError && error.code === "invalid-utf8",
  );
  const links = Array.from({ length: 10_001 }, (_, index) => regularLink({ id: `id-${index}` }));
  assert.throws(() => parseResearchLinksBytes(bytes({ version: 1, links })), invalidFile(/rows/));
  assert.throws(
    () => parseResearchLinksBytes({ byteLength: MAX_RESEARCH_LINKS_FILE_BYTES + 1 } as Uint8Array),
    (error) => error instanceof ResearchLinksLegacyStoreError && error.code === "too-large",
  );
});

test("serializer rejects an oversized aggregate before constructing whole-file JSON", () => {
  const abstract = "\0".repeat(1024 * 1024);
  const links = Array.from({ length: 43 }, (_, index) => regularLink({
    id: `large-paper-${index}`,
    url: `https://example.com/paper/${index}`,
    category: "paper",
    paper: {
      arxivId: `2608.${String(index).padStart(5, "0")}`,
      authors: ["Researcher"],
      abstract,
      publishedAt: "2026-08-26T00:00:00.000Z",
    },
  }));
  assert.throws(
    () => serializeResearchLinks({ version: 1, links }),
    (error) => error instanceof ResearchLinksLegacyStoreError && error.code === "too-large",
  );
});

test("accepts prior-compatible nonempty legacy ids without deriving them into paths", () => {
  const id = "legacy saved link ../ retained";
  assert.equal(validateAndDetachSavedLink(regularLink({ id })).id, id);
  for (const invalidId of ["", " ", " surrounded ", "x".repeat(129)]) {
    assert.throws(
      () => validateAndDetachSavedLink(regularLink({ id: invalidId })),
      invalidFile(/id is invalid/),
    );
  }
});

test("rejects invalid fields and incomplete paper blocks without normalization", () => {
  for (const link of [
    regularLink({ url: "file:///etc/passwd" }),
    regularLink({ title: " " }),
    regularLink({ addedAt: "2026-08-27T12:00:00Z" }),
    { ...regularLink(), category: "unknown" },
    { ...regularLink(), source: "import" },
    { ...regularLink(), paper: { arxivId: "2608.12345" } },
  ]) {
    assert.throws(() => validateAndDetachSavedLink(link), invalidFile(/invalid/));
  }
});

test("rejects duplicate ids and normalized URL identities", () => {
  assert.throws(
    () => parseResearchLinksBytes(bytes({
      version: 1,
      links: [regularLink(), regularLink({ url: "https://example.org", title: "Other" })],
    })),
    invalidFile(/id is duplicated/),
  );
  assert.throws(
    () => parseResearchLinksBytes(bytes({
      version: 1,
      links: [
        xLink(),
        regularLink({ id: "x-alias", url: "https://twitter.com/i/web/status/123" }),
      ],
    })),
    invalidFile(/identity is duplicated/),
  );
});

test("X Article validation binds URL identity and verifies exact body digest", () => {
  const mismatch = xLink();
  mismatch.xArticle!.sourcePostId = "124";
  assert.throws(() => validateAndDetachSavedLink(mismatch), invalidFile(/xArticle/));

  const corrupted = xLink();
  corrupted.xArticle!.body += " changed";
  assert.throws(() => validateAndDetachSavedLink(corrupted), invalidFile(/xArticle/));

  const invalidTimestamp = xLink();
  invalidTimestamp.xArticle!.fetchedAt = "2026-08-27 12:00:00";
  assert.throws(() => validateAndDetachSavedLink(invalidTimestamp), invalidFile(/timestamp/));
});

test("X Article validation applies the existing canonical normalizers exactly once", () => {
  const link = xLink();
  const body = "Canonical body";
  link.xArticle = {
    ...link.xArticle!,
    body: ` \n${body}\n `,
    contentSha256: xArticleContentSha256(body),
    coverImageUrl: "https://example.com",
    publishedAt: "2026-08-26T08:00:00-04:00",
    fetchedAt: "2026-08-27T12:00:00Z",
  };
  const validated = validateAndDetachSavedLink(link);
  assert.equal(validated.xArticle!.body, body);
  assert.equal(validated.xArticle!.coverImageUrl, "https://example.com/");
  assert.equal(validated.xArticle!.publishedAt, "2026-08-26T12:00:00.000Z");
  assert.equal(validated.xArticle!.fetchedAt, "2026-08-27T12:00:00.000Z");
});

test("GitHub snapshot validation rejects malformed, extra, and unbounded fields", () => {
  const missingSha = structuredClone(githubLink());
  delete (missingSha.githubRepo!.tree[0] as { sha?: string }).sha;
  assert.throws(() => validateAndDetachSavedLink(missingSha), invalidFile(/githubRepo/));

  const extraField = structuredClone(githubLink()) as SavedLink & {
    githubRepo: NonNullable<SavedLink["githubRepo"]> & { token: string };
  };
  extraField.githubRepo.token = "must-not-persist";
  assert.throws(() => validateAndDetachSavedLink(extraField), invalidFile(/githubRepo/));

  const wrongRepository = structuredClone(githubLink());
  wrongRepository.githubRepo!.repo = "other";
  assert.throws(() => validateAndDetachSavedLink(wrongRepository), invalidFile(/githubRepo/));

  const oversizedTree = structuredClone(githubLink());
  oversizedTree.githubRepo!.tree = Array.from({ length: 401 }, (_, index) => ({
    path: `file-${index}.txt`,
    type: "blob" as const,
    sha: "b".repeat(40),
  }));
  assert.throws(() => validateAndDetachSavedLink(oversizedTree), invalidFile(/githubRepo/));
});

test("missing reads are empty and atomic writes verify exact projected bytes", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "research-links-legacy-"));
  const target = path.join(directory, "nested", "research-links.json");
  try {
    assert.deepEqual(await readResearchLinksStrict({ path: target }), { version: 1, links: [] });
    const file = { version: 1 as const, links: [xLink(), regularLink()] };
    const written = await writeResearchLinksVerified(file, { path: target });
    assert.deepEqual(await readFile(target), Buffer.from(written.bytes));
    assert.equal(written.digest, researchLinksDigest(written.bytes));
    assert.deepEqual(await readResearchLinksStrict({ path: target }), file);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("first upgrade accepts a valid historical 0644 file and hardens its opened inode", {
  skip: process.platform === "win32" ? "POSIX mode bits do not apply on Windows" : false,
}, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "research-links-historical-mode-"));
  const target = path.join(directory, "research-links.json");
  const file = { version: 1 as const, links: [regularLink()] };
  try {
    await writeFile(target, serializeResearchLinks(file), { mode: 0o644 });
    await chmod(target, 0o644);

    assert.deepEqual(await readResearchLinksStrict({ path: target }), file);
    assert.equal((await lstat(target)).mode & 0o777, 0o600);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("verified publication is private at first visibility and leaves no temporary file", {
  skip: process.platform === "win32" ? "POSIX mode bits do not apply on Windows" : false,
}, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "research-links-durable-private-"));
  const targetDirectory = path.join(directory, "nested");
  const target = path.join(targetDirectory, "research-links.json");
  const file = { version: 1 as const, links: [xLink()] };
  try {
    const written = await writeResearchLinksVerified(file, { path: target });
    const published = await lstat(target);
    assert.equal(published.mode & 0o777, 0o600);
    assert.equal(published.nlink, 1);
    assert.deepEqual(await readFile(target), Buffer.from(written.bytes));
    assert.deepEqual(await readdir(targetDirectory), ["research-links.json"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("read failures preserve bounded error detail without path or file data", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "research-links-private-"));
  const target = path.join(directory, "secret-name.json");
  const secret = "private-content-marker";
  try {
    await writeFile(target, `{${secret}`);
    await assert.rejects(
      () => readResearchLinksStrict({ path: target }),
      (error) => error instanceof ResearchLinksLegacyStoreError
        && !error.message.includes(target)
        && !error.message.includes(secret)
        && error.message.length < 160,
    );
    if (process.platform !== "win32") {
      assert.equal(
        (await lstat(target)).mode & 0o777,
        0o644,
        "invalid historical bytes are not blessed by the permission upgrade",
      );
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("strict reads refuse a symbolic-link store instead of following it", {
  skip: process.platform === "win32" ? "symbolic links require platform privileges" : false,
}, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "research-links-symlink-"));
  const outside = path.join(directory, "outside.json");
  const target = path.join(directory, "research-links.json");
  try {
    await writeFile(outside, JSON.stringify({ version: 1, links: [] }));
    await symlink(outside, target);
    await assert.rejects(() => readResearchLinksStrict({ path: target }), invalidFile(/regular file/));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("strict reads refuse multiply-linked stores", {
  skip: process.platform === "win32" ? "hard-link behavior varies on Windows" : false,
}, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "research-links-hardlink-"));
  const outside = path.join(directory, "outside.json");
  const target = path.join(directory, "research-links.json");
  try {
    await writeFile(outside, JSON.stringify({ version: 1, links: [] }), { mode: 0o600 });
    await link(outside, target);
    await assert.rejects(() => readResearchLinksStrict({ path: target }), invalidFile(/safe regular file/));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("strict reads refuse group- or world-accessible POSIX modes", {
  skip: process.platform === "win32" ? "POSIX mode bits do not apply on Windows" : false,
}, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "research-links-mode-"));
  const target = path.join(directory, "research-links.json");
  try {
    await writeFile(target, JSON.stringify({ version: 1, links: [] }), { mode: 0o600 });
    await chmod(target, 0o640);
    await assert.rejects(() => readResearchLinksStrict({ path: target }), invalidFile(/permissions/));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
