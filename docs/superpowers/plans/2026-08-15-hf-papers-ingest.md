# HF Paper Ingest with pdf.js Viewer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pasting `hf papers read 2401.12345` (or an HF papers / arXiv URL) into Research Desk resources saves one paper resource with real title, authors and abstract, and opening it renders the PDF inline with pdf.js.

**Architecture:** A pure parser canonicalizes every spelling to one HF papers URL so the existing normalized-URL dedupe collapses them. Server-side metadata enrichment degrades rather than failing the save. A same-origin proxy route streams the arXiv PDF; a dynamically-imported pdf.js viewer renders it with a text layer for selection and search.

**Tech Stack:** TypeScript, Next 16 (App Router), React 19, `node --test` with `--experimental-strip-types`, Playwright (daemon-less), `pdfjs-dist`.

**Spec:** `docs/superpowers/specs/2026-08-15-hf-papers-ingest-design.md` · **Bead:** `cave-cbz28`

---

## Repo conventions that apply to every task

Read these once; they are not repeated per task.

- **Every new test file must be registered** in `scripts/run-tests.mjs` or it never runs. Add to the `app:` array (lines ~24–1240). A test that imports `@/…` as a *runtime value* must also join the `ALIAS_LOADER` set (line ~1736) or it dies with `ERR_MODULE_NOT_FOUND` in CI while passing locally. This exact omission broke `main` on 2026-08-14 (`cave-nzfiy`).
- **Commits are signed and carry no AI attribution.** Use `git commit -S`. Never add `Co-Authored-By: Claude` or `Generated with` — `AGENTS.md` forbids it and it overrides any global habit.
- **Run a single test file:** `node --experimental-strip-types --test <file>`. If the file is in `ALIAS_LOADER`, add `--import ./scripts/test-alias-register.mjs` before the file path.
- **Run the whole suite:** `pnpm test:app`.
- **Components must pass the design-token codemod.** `pnpm lint` runs `codemod:design:check` over `src/components/**`; raw colour/spacing literals fail.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/lib/hf-papers.ts` (new) | Pure. Recognise paper references in text; canonicalize to an arXiv id and an HF URL. No imports. |
| `src/lib/hf-papers.test.ts` (new) | Pattern matrix including near-misses. |
| `src/lib/link-organizer.ts` (modify) | Add the `huggingface.co/papers/*` → `paper` path rule; extend `SavedLink` with optional `paper`. |
| `src/lib/server/hf-paper-metadata.ts` (new) | Fetch and map HF paper metadata; degrade on failure. `fetch` injected for testing. |
| `src/lib/server/research-links.ts` (modify) | Validate/drop the `paper` block on read; carry it on save. |
| `src/app/api/research/links/route.ts` (modify) | Run the parser over pasted text; enrich before save. |
| `src/app/api/research/papers/pdf/route.ts` (new) | Stream `arxiv.org/pdf/<id>` same-origin, guarded. |
| `src/lib/research-paper-view.ts` (new) | Pure viewer state machine (idle → loading → ready → error, cancellation). |
| `src/components/research-paper-viewer.tsx` (new) | pdf.js canvas + text layer, chrome, actions. Client-only. |
| `tests/research-paper-viewer.spec.ts` (new) | Daemon-less e2e against a committed fixture PDF. |
| `tests/fixtures/sample-paper.pdf` (new) | One-page PDF with known text. |

---

### Task 1: Reference parser

**Files:**
- Create: `src/lib/hf-papers.ts`
- Test: `src/lib/hf-papers.test.ts`
- Modify: `scripts/run-tests.mjs`

- [ ] **Step 1: Write the failing test**

Create `src/lib/hf-papers.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { hfPaperUrl, isArxivPaperId, parseHfPaperReferences } from "./hf-papers.ts";

test("recognises both command spellings", () => {
  assert.deepEqual(parseHfPaperReferences("hf papers read 2401.12345"), ["2401.12345"]);
  assert.deepEqual(parseHfPaperReferences("hf paper read 2401.12345"), ["2401.12345"]);
});

test("strips a version suffix to the canonical id", () => {
  assert.deepEqual(parseHfPaperReferences("hf papers read 2401.12345v2"), ["2401.12345"]);
});

test("recognises HF and arXiv URLs", () => {
  assert.deepEqual(parseHfPaperReferences("https://huggingface.co/papers/2401.12345"), ["2401.12345"]);
  assert.deepEqual(parseHfPaperReferences("https://arxiv.org/abs/2401.12345"), ["2401.12345"]);
  assert.deepEqual(parseHfPaperReferences("https://arxiv.org/pdf/2401.12345"), ["2401.12345"]);
});

test("collapses every spelling of one paper to a single id", () => {
  const text = [
    "hf papers read 2401.12345",
    "https://huggingface.co/papers/2401.12345",
    "https://arxiv.org/pdf/2401.12345v3",
  ].join("\n");
  assert.deepEqual(parseHfPaperReferences(text), ["2401.12345"]);
});

test("does NOT match a bare id with no command or URL", () => {
  assert.deepEqual(parseHfPaperReferences("the figure on 2401.12345 is wrong"), []);
});

test("does NOT match an over-long number", () => {
  assert.deepEqual(parseHfPaperReferences("hf papers read 2401.1234567"), []);
});

test("canonical URL and id guard", () => {
  assert.equal(hfPaperUrl("2401.12345"), "https://huggingface.co/papers/2401.12345");
  assert.equal(isArxivPaperId("2401.12345"), true);
  assert.equal(isArxivPaperId("2401.1234567"), false);
  assert.equal(isArxivPaperId("../etc/passwd"), false);
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `node --experimental-strip-types --test src/lib/hf-papers.test.ts`
Expected: FAIL — `Cannot find module './hf-papers.ts'`.

- [ ] **Step 3: Implement**

Create `src/lib/hf-papers.ts`:

```ts
/**
 * Recognise Hugging Face paper references in free text.
 *
 * A bare `2401.12345` is deliberately NOT matched: pasted prose is full of
 * decimal numbers and version strings, and manufacturing resources from them
 * is worse than missing one. The `hf papers read` command or a URL is the
 * signal that the number is a paper.
 */

/** arXiv ids are `YYMM.NNNNN`, optionally with a `vN` revision suffix. */
const ARXIV_ID = String.raw`(\d{4}\.\d{4,5})(?:v\d+)?`;

const PATTERNS = [
  new RegExp(String.raw`\bhf\s+papers?\s+read\s+${ARXIV_ID}\b`, "gi"),
  new RegExp(String.raw`https?://(?:www\.)?huggingface\.co/papers/${ARXIV_ID}\b`, "gi"),
  new RegExp(String.raw`https?://(?:www\.)?arxiv\.org/(?:abs|pdf)/${ARXIV_ID}(?:\.pdf)?\b`, "gi"),
];

/** Canonical ids, deduped, in first-seen order. The `vN` suffix is dropped. */
export function parseHfPaperReferences(text: string): string[] {
  if (!text) return [];
  const seen = new Set<string>();
  for (const pattern of PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) seen.add(match[1]);
  }
  return [...seen];
}

export function hfPaperUrl(arxivId: string): string {
  return `https://huggingface.co/papers/${arxivId}`;
}

/** Guard for anything that interpolates an id into a URL or a path. */
export function isArxivPaperId(value: string): boolean {
  return /^\d{4}\.\d{4,5}$/.test(value);
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `node --experimental-strip-types --test src/lib/hf-papers.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Register the test**

In `scripts/run-tests.mjs`, in the `app:` array beside the other `src/lib/*.test.ts` entries (near `"src/lib/link-organizer.test.ts"`, ~line 995), add:

```js
    "src/lib/hf-papers.test.ts",
```

Do **not** add it to `ALIAS_LOADER` — `hf-papers.ts` imports nothing.

- [ ] **Step 6: Verify it runs in the suite**

Run: `pnpm test:app 2>&1 | grep hf-papers`
Expected: a line showing the file ran.

- [ ] **Step 7: Commit**

```bash
git add src/lib/hf-papers.ts src/lib/hf-papers.test.ts scripts/run-tests.mjs
git commit -S -m "feat(research): recognise HF paper references in pasted text

Canonicalizes the two command spellings, the HF papers URL and arXiv
abs/pdf URLs to one arXiv id, so the existing normalized-URL dedupe
collapses them into a single resource. A bare id with no command or URL
around it is not matched, because pasted prose is full of decimals.

Bead: cave-cbz28"
```

---

### Task 2: Categorise HF paper URLs as papers

`huggingface.co` also serves models, datasets, spaces and blog posts, so the host cannot
join `PAPER_HOSTS` — only the `/papers/` path may.

**Files:**
- Modify: `src/lib/link-organizer.ts:116-131` (`categorizeLink`)
- Test: `src/lib/link-organizer.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/link-organizer.test.ts`:

```ts
test("huggingface.co/papers is a paper, other HF paths are not", () => {
  assert.equal(categorizeLink("https://huggingface.co/papers/2401.12345"), "paper");
  assert.notEqual(categorizeLink("https://huggingface.co/models/meta-llama/Llama-3"), "paper");
  assert.notEqual(categorizeLink("https://huggingface.co/datasets/squad"), "paper");
  assert.notEqual(categorizeLink("https://huggingface.co/blog/some-post"), "paper");
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `node --experimental-strip-types --test src/lib/link-organizer.test.ts`
Expected: FAIL — the first assertion gets `"other"`, not `"paper"`.

- [ ] **Step 3: Implement**

In `src/lib/link-organizer.ts`, inside `categorizeLink`, immediately **before** the
`if (hostMatches(host, PAPER_HOSTS)) return "paper";` line, insert:

```ts
  // huggingface.co also serves models, datasets, spaces and blog posts, so the
  // host cannot join PAPER_HOSTS — only this path may.
  if (host === "huggingface.co" && /^\/papers\//.test(pathname)) return "paper";
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `node --experimental-strip-types --test src/lib/link-organizer.test.ts`
Expected: PASS, including the pre-existing tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/link-organizer.ts src/lib/link-organizer.test.ts
git commit -S -m "feat(research): categorise huggingface.co/papers as papers

Path-aware rather than host-wide: huggingface.co also serves models,
datasets, spaces and blog posts, and putting the host in PAPER_HOSTS
would mislabel all of them.

Bead: cave-cbz28"
```

---

### Task 3: Carry paper metadata on the saved link

**Files:**
- Modify: `src/lib/link-organizer.ts:46-54` (`SavedLink`)
- Modify: `src/lib/server/research-links.ts` (`normalizeStoredLink`)
- Test: `src/lib/server/research-links.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/server/research-links.test.ts`:

```ts
test("keeps a well-formed paper block and drops a malformed one", async () => {
  const good = {
    id: "a", url: "https://huggingface.co/papers/2401.12345", category: "paper",
    title: "T", addedAt: new Date().toISOString(), source: "desk",
    paper: { arxivId: "2401.12345", authors: ["A"], abstract: "x", publishedAt: "2024-01-22T00:00:00.000Z" },
  };
  const bad = { ...good, id: "b", paper: { arxivId: "../etc/passwd", authors: "not-an-array" } };

  assert.deepEqual(normalizeStoredLinkForTest(good)?.paper?.authors, ["A"]);
  assert.equal(normalizeStoredLinkForTest(bad)?.paper, undefined);
});
```

**Do NOT export `normalizeStoredLink` to test it.** It is deliberately module-private, and
the existing test file already has a better idiom: it points
`CAVE_RESEARCH_LINKS_PATH_OVERRIDE` at a temp directory and drives the public API. Follow
that — write a `research-links.json` containing one good and one malformed `paper` block,
call `listSavedLinks()`, and assert what survives. That tests the actual read path
including the JSON round-trip, rather than a function pulled out of its context.

- [ ] **Step 2: Run it and confirm it fails**

Run: `node --experimental-strip-types --import ./scripts/test-alias-register.mjs --test src/lib/server/research-links.test.ts`
Expected: FAIL — `paper` is stripped from both, so the first assertion gets `undefined`.

- [ ] **Step 3: Extend the type**

In `src/lib/link-organizer.ts`, extend `SavedLink` (currently lines 46–54):

```ts
export type SavedLink = {
  id: string;
  url: string;
  category: LinkCategory;
  title: string;
  addedAt: string;
  /** Where the save originated. */
  source: "chat" | "desk";
  /** Present only for papers resolved through hf-papers ingest. */
  paper?: {
    arxivId: string;
    authors: string[];
    abstract: string;
    publishedAt: string;
  };
};
```

- [ ] **Step 4: Validate it on read**

In `src/lib/server/research-links.ts`, add above `normalizeStoredLink`:

> **Use a RELATIVE import, not the `@/` alias.** This file imports its neighbours as
> `../link-organizer.ts` and `./atomic-write.ts`, and `research-links.test.ts` is
> deliberately NOT in `ALIAS_LOADER`. Introducing an `@/` import here would make the test
> throw `ERR_MODULE_NOT_FOUND` in CI while still passing locally — the `cave-nzfiy`
> failure. Either import relatively (correct, no registration change) or add the test to
> `ALIAS_LOADER` (unnecessary churn). Import relatively.

```ts
import { isArxivPaperId } from "../hf-papers.ts";

function normalizePaperBlock(value: unknown): SavedLink["paper"] {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  // Disk contents are user-editable, and arxivId is interpolated into a URL by
  // the PDF route — validate it here rather than trusting the file.
  if (typeof raw.arxivId !== "string" || !isArxivPaperId(raw.arxivId)) return undefined;
  if (!Array.isArray(raw.authors) || !raw.authors.every((a) => typeof a === "string")) return undefined;
  if (typeof raw.abstract !== "string") return undefined;
  if (typeof raw.publishedAt !== "string") return undefined;
  return {
    arxivId: raw.arxivId,
    authors: raw.authors as string[],
    abstract: raw.abstract,
    publishedAt: raw.publishedAt,
  };
}
```

Then in `normalizeStoredLink`'s returned object, after `source: …`, add:

```ts
    ...(normalizePaperBlock((value as { paper?: unknown }).paper)
      ? { paper: normalizePaperBlock((value as { paper?: unknown }).paper) }
      : {}),
```

- [ ] **Step 5: Run it and confirm it passes**

Run: `node --experimental-strip-types --import ./scripts/test-alias-register.mjs --test src/lib/server/research-links.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/link-organizer.ts src/lib/server/research-links.ts src/lib/server/research-links.test.ts
git commit -S -m "feat(research): carry paper metadata on saved links

Optional field, so no migration — absent on every existing record. The
block is validated on read and dropped whole if malformed, matching how
category and addedAt are already re-derived rather than trusted, and
because arxivId is later interpolated into a URL by the PDF route.

Bead: cave-cbz28"
```

---

### Task 4: Fetch HF paper metadata

**Files:**
- Create: `src/lib/server/hf-paper-metadata.ts`
- Test: `src/lib/server/hf-paper-metadata.test.ts`
- Modify: `scripts/run-tests.mjs`

- [ ] **Step 1: Write the failing test**

Create `src/lib/server/hf-paper-metadata.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { fetchHfPaperMetadata } from "./hf-paper-metadata.ts";

const PAYLOAD = {
  id: "2401.12345",
  title: "Distributionally Robust Receive Beamforming",
  authors: [{ name: "Shixiong Wang" }, { name: "Wei Dai" }],
  publishedAt: "2024-01-22T20:20:48.000Z",
  summary: "This article investigates signal estimation.",
};

test("maps the HF payload", async () => {
  const result = await fetchHfPaperMetadata("2401.12345", {
    fetchImpl: async () => new Response(JSON.stringify(PAYLOAD), { status: 200 }),
  });
  assert.deepEqual(result, {
    title: "Distributionally Robust Receive Beamforming",
    authors: ["Shixiong Wang", "Wei Dai"],
    abstract: "This article investigates signal estimation.",
    publishedAt: "2024-01-22T20:20:48.000Z",
  });
});

test("degrades to null on a non-OK response", async () => {
  const result = await fetchHfPaperMetadata("2401.12345", {
    fetchImpl: async () => new Response("nope", { status: 404 }),
  });
  assert.equal(result, null);
});

test("degrades to null when the fetch throws", async () => {
  const result = await fetchHfPaperMetadata("2401.12345", {
    fetchImpl: async () => { throw new Error("network down"); },
  });
  assert.equal(result, null);
});

test("refuses an id that is not an arXiv id", async () => {
  let called = false;
  const result = await fetchHfPaperMetadata("../etc/passwd", {
    fetchImpl: async () => { called = true; return new Response("{}", { status: 200 }); },
  });
  assert.equal(result, null);
  assert.equal(called, false, "must not issue a request for an invalid id");
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `node --experimental-strip-types --import ./scripts/test-alias-register.mjs --test src/lib/server/hf-paper-metadata.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/server/hf-paper-metadata.ts`:

```ts
import { isArxivPaperId } from "@/lib/hf-papers";

export type HfPaperMetadata = {
  title: string;
  authors: string[];
  abstract: string;
  publishedAt: string;
};

/**
 * Ingest is an interactive paste: the budget is how long a person will wait
 * for it to land, not how long HF might take.
 */
const TIMEOUT_MS = 5_000;

export async function fetchHfPaperMetadata(
  arxivId: string,
  options: { fetchImpl?: typeof fetch } = {},
): Promise<HfPaperMetadata | null> {
  if (!isArxivPaperId(arxivId)) return null;
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetchImpl(`https://huggingface.co/api/papers/${arxivId}`, {
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const body = (await response.json()) as Record<string, unknown>;
    const title = typeof body.title === "string" ? body.title : "";
    if (!title) return null;
    const authors = Array.isArray(body.authors)
      ? body.authors
          .map((a) => (a && typeof a === "object" ? (a as { name?: unknown }).name : null))
          .filter((n): n is string => typeof n === "string" && n.length > 0)
      : [];
    return {
      title,
      authors,
      abstract: typeof body.summary === "string" ? body.summary : "",
      publishedAt: typeof body.publishedAt === "string" ? body.publishedAt : "",
    };
  } catch {
    // A flaky third party must not cost the user their paste; the caller keeps
    // the derived title instead.
    return null;
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `node --experimental-strip-types --import ./scripts/test-alias-register.mjs --test src/lib/server/hf-paper-metadata.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Register the test**

In `scripts/run-tests.mjs`: add `"src/lib/server/hf-paper-metadata.test.ts",` to the `app:`
array near `"src/lib/server/research-links.test.ts"` (~line 382), **and** add the same
string to the `ALIAS_LOADER` set (~line 1736) with a comment:

```js
  // hf-paper-metadata.ts imports "@/lib/hf-papers" as a runtime value.
  "src/lib/server/hf-paper-metadata.test.ts",
```

- [ ] **Step 6: Prove the registration works**

Run: `pnpm test:app 2>&1 | grep hf-paper-metadata`
Expected: the file ran and passed. If it reports `ERR_MODULE_NOT_FOUND`, the
`ALIAS_LOADER` entry is missing or misspelled.

- [ ] **Step 7: Commit**

```bash
git add src/lib/server/hf-paper-metadata.ts src/lib/server/hf-paper-metadata.test.ts scripts/run-tests.mjs
git commit -S -m "feat(research): fetch HF paper metadata, degrading on failure

Returns null rather than throwing on a bad id, a non-OK response or a
network error, so ingest keeps the derived title instead of losing the
paste. 5s timeout, because this sits in an interactive paste.

Bead: cave-cbz28"
```

---

### Task 5: Wire the parser and enrichment into ingest

**Files:**
- Modify: `src/app/api/research/links/route.ts:37-70` (`POST`)
- Test: `src/app/api/research/links/route.test.ts` (create if absent)
- Modify: `scripts/run-tests.mjs`

- [ ] **Step 1: Write the failing test**

Create or append to `src/app/api/research/links/route.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { collectIngestUrls } from "./ingest-urls.ts";

test("a command with no URL still yields the canonical paper URL", () => {
  assert.deepEqual(
    collectIngestUrls({ text: "hf papers read 2401.12345" }),
    ["https://huggingface.co/papers/2401.12345"],
  );
});

test("a paper pasted twice in different spellings yields one URL", () => {
  assert.deepEqual(
    collectIngestUrls({ text: "hf papers read 2401.12345 https://arxiv.org/abs/2401.12345" }),
    ["https://huggingface.co/papers/2401.12345"],
  );
});

test("ordinary URLs still come through", () => {
  const urls = collectIngestUrls({ text: "see https://example.com/post" });
  assert.ok(urls.includes("https://example.com/post"));
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `node --experimental-strip-types --import ./scripts/test-alias-register.mjs --test src/app/api/research/links/route.test.ts`
Expected: FAIL — `./ingest-urls.ts` not found.

- [ ] **Step 3: Implement the pure helper**

Create `src/app/api/research/links/ingest-urls.ts`. It is a separate module so the
merge logic is testable without constructing a `Request`:

```ts
import { extractLinks } from "@/lib/link-extractor";
import { hfPaperUrl, parseHfPaperReferences } from "@/lib/hf-papers";

/**
 * Merge explicit URLs, URLs found in pasted text, and paper references.
 *
 * Paper ids are resolved to their canonical HF URL and placed FIRST, so that
 * when the same paper also appears as a raw arXiv URL the canonical form is
 * the one that survives the caller's dedupe.
 */
export function collectIngestUrls(input: { urls?: unknown; text?: unknown }): string[] {
  const out: string[] = [];
  const text = typeof input.text === "string" ? input.text : "";

  for (const id of parseHfPaperReferences(text)) out.push(hfPaperUrl(id));

  if (Array.isArray(input.urls)) {
    for (const raw of input.urls) {
      if (typeof raw === "string" && raw.trim()) out.push(raw.trim());
    }
  }
  if (text.trim()) out.push(...extractLinks(text));

  // Drop any raw arXiv/HF URL for a paper already represented canonically.
  const paperIds = new Set(parseHfPaperReferences(text));
  return [...new Set(out)].filter((url) => {
    if (url.startsWith("https://huggingface.co/papers/")) return true;
    const ids = parseHfPaperReferences(url);
    return ids.length === 0 || !ids.some((id) => paperIds.has(id));
  });
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `node --experimental-strip-types --import ./scripts/test-alias-register.mjs --test src/app/api/research/links/route.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Use it in the route**

In `src/app/api/research/links/route.ts`, replace the URL-gathering block in `POST`
(the `const urls: string[] = []; …` section through the `extractLinks` call) with:

```ts
  const urls = collectIngestUrls(parsed.body);
```

and add to the imports:

```ts
import { collectIngestUrls } from "./ingest-urls";
```

- [ ] **Step 6: Enrich papers before saving**

Still in `POST`, after `urls` is computed and before the existing save call, add:

```ts
  const enrichment = new Map<string, Awaited<ReturnType<typeof fetchHfPaperMetadata>>>();
  for (const url of urls) {
    const [arxivId] = parseHfPaperReferences(url);
    if (!arxivId) continue;
    enrichment.set(url, await fetchHfPaperMetadata(arxivId));
  }
```

Then widen `saveResearchLinks` in `src/lib/server/research-links.ts` to accept the map as
an optional second argument:

```ts
export async function saveResearchLinks(
  urls: string[],
  source: "chat" | "desk",
  enrichment?: Map<string, HfPaperMetadata | null>,
): Promise<SaveLinksResult> {
```

and at the point where it builds each new `SavedLink` (currently around line 165, where
`title: deriveLinkTitle(trimmed)` is set), replace that construction with:

```ts
      const meta = enrichment?.get(trimmed) ?? null;
      const [arxivId] = parseHfPaperReferences(trimmed);
      const link: SavedLink = {
        id: randomUUID(),
        url: trimmed,
        category: categorizeLink(trimmed),
        title: meta?.title || deriveLinkTitle(trimmed),
        addedAt: new Date().toISOString(),
        source,
        ...(meta && arxivId
          ? {
              paper: {
                arxivId,
                authors: meta.authors,
                abstract: meta.abstract,
                publishedAt: meta.publishedAt,
              },
            }
          : {}),
      };
```

Where metadata is `null` this produces exactly today's record. Add to that file's imports:

```ts
import { parseHfPaperReferences } from "@/lib/hf-papers";
import type { HfPaperMetadata } from "@/lib/server/hf-paper-metadata";
```

Add to the route's imports:

```ts
import { parseHfPaperReferences } from "@/lib/hf-papers";
import { fetchHfPaperMetadata } from "@/lib/server/hf-paper-metadata";
```

- [ ] **Step 7: Run the suite**

Run: `pnpm test:app`
Expected: PASS. Register `src/app/api/research/links/route.test.ts` in `scripts/run-tests.mjs`
(`app:` array) and in `ALIAS_LOADER` — it imports `@/lib/…` runtime values.

- [ ] **Step 8: Commit**

```bash
git add src/app/api/research/links/ src/lib scripts/run-tests.mjs
git commit -S -m "feat(research): ingest HF paper references from pasted text

extractLinks finds nothing in 'hf papers read 2401.12345' because it
contains no URL, so the parser runs over the same text and contributes
the canonical HF URL. Canonical URLs are placed first so a paper pasted
in two spellings dedupes to one resource.

Bead: cave-cbz28"
```

---

### Task 6: PDF proxy route

**Files:**
- Create: `src/app/api/research/papers/pdf/route.ts`
- Test: `src/app/api/research/papers/pdf/route.test.ts`
- Modify: `scripts/run-tests.mjs`

- [ ] **Step 1: Write the failing test**

Create `src/app/api/research/papers/pdf/route.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { arxivPdfUrl } from "./arxiv-url.ts";

test("builds the arXiv URL from a valid id", () => {
  assert.equal(arxivPdfUrl("2401.12345"), "https://arxiv.org/pdf/2401.12345");
});

test("refuses anything that is not an arXiv id", () => {
  for (const bad of ["../etc/passwd", "2401.1234567", "evil.com/x", "", "2401.12345 "]) {
    assert.equal(arxivPdfUrl(bad), null, `must refuse ${JSON.stringify(bad)}`);
  }
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `node --experimental-strip-types --import ./scripts/test-alias-register.mjs --test src/app/api/research/papers/pdf/route.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the URL builder**

Create `src/app/api/research/papers/pdf/arxiv-url.ts`:

```ts
import { isArxivPaperId } from "@/lib/hf-papers";

/**
 * The id is validated and then interpolated into a hard-coded arXiv URL. It
 * never composes a host, a scheme or a path prefix, so there is no SSRF
 * surface here.
 */
export function arxivPdfUrl(arxivId: string): string | null {
  if (!isArxivPaperId(arxivId)) return null;
  return `https://arxiv.org/pdf/${arxivId}`;
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `node --experimental-strip-types --import ./scripts/test-alias-register.mjs --test src/app/api/research/papers/pdf/route.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Implement the route**

Create `src/app/api/research/papers/pdf/route.ts`:

```ts
import { NextResponse } from "next/server";

import { rejectNonLocalRequest } from "@/lib/server/api-security";

import { arxivPdfUrl } from "./arxiv-url";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;

  const id = new URL(req.url).searchParams.get("id")?.trim() ?? "";
  const upstream = arxivPdfUrl(id);
  if (!upstream) {
    return NextResponse.json({ ok: false, error: "invalid paper id" }, { status: 400 });
  }

  const range = req.headers.get("range");
  let response: Response;
  try {
    response = await fetch(upstream, { headers: range ? { range } : {} });
  } catch {
    return NextResponse.json({ ok: false, error: "upstream unavailable" }, { status: 502 });
  }
  if (!response.ok && response.status !== 206) {
    return NextResponse.json({ ok: false, error: "paper not found" }, { status: 404 });
  }

  const headers = new Headers({ "content-type": "application/pdf" });
  for (const key of ["content-length", "content-range", "accept-ranges"]) {
    const value = response.headers.get(key);
    if (value) headers.set(key, value);
  }
  return new NextResponse(response.body, { status: response.status, headers });
}
```

- [ ] **Step 6: Register and run the suite**

Add `"src/app/api/research/papers/pdf/route.test.ts",` to the `app:` array and to
`ALIAS_LOADER` (it imports `@/lib/hf-papers`).

Run: `pnpm test:app 2>&1 | grep papers/pdf`
Expected: the file ran and passed.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/research/papers scripts/run-tests.mjs
git commit -S -m "feat(research): proxy the arXiv PDF same-origin

pdf.js fetches the bytes from our own origin, so CORS never enters the
picture, the local-only guard stays consistent with sibling routes, and
third-party fetch behaviour under WKWebView is out of the picture. The
id is validated and interpolated into a hard-coded arXiv URL, so it
never composes a host or scheme.

Bead: cave-cbz28"
```

---

### Task 7: Add pdf.js and its worker asset

**Files:**
- Modify: `package.json`
- Create: `scripts/copy-pdf-worker.mjs`

- [ ] **Step 1: Add the dependency, pinned exactly**

Run: `pnpm add pdfjs-dist@5.4.149`

Then open `package.json` and remove any `^` from the `pdfjs-dist` entry.
`scripts/dependency-policy.test.mjs` asserts every dependency matches
`^\d+\.\d+\.\d+…$`, so a caret fails the suite.

- [ ] **Step 2: Verify the policy test still passes**

Run: `node --experimental-strip-types --test scripts/dependency-policy.test.mjs`
Expected: PASS. If it fails on `pdfjs-dist`, the version still has a caret.

- [ ] **Step 3: Write the worker copy script**

Create `scripts/copy-pdf-worker.mjs`:

```js
// pdf.js parses in a Web Worker. This is the first Web Worker in the codebase,
// so rather than depending on Turbopack's worker handling we copy the asset to
// public/ and reference it by URL — which is also what the packaged desktop
// shell serves.
import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const source = require.resolve("pdfjs-dist/build/pdf.worker.min.mjs");
const target = path.join(process.cwd(), "public", "pdf.worker.min.mjs");

await mkdir(path.dirname(target), { recursive: true });
await copyFile(source, target);
console.log(`[copy-pdf-worker] ${source} -> ${target}`);
```

- [ ] **Step 4: Run it on postinstall**

In `package.json` `scripts`, add:

```json
    "postinstall": "node scripts/copy-pdf-worker.mjs",
```

If a `postinstall` already exists, append with ` && node scripts/copy-pdf-worker.mjs`.

- [ ] **Step 5: Verify the asset lands**

Run: `node scripts/copy-pdf-worker.mjs && ls -l public/pdf.worker.min.mjs`
Expected: the file exists and is non-empty.

- [ ] **Step 6: Ignore the generated asset**

Add to `.gitignore`:

```
public/pdf.worker.min.mjs
```

It is a build product of a pinned dependency; committing it would duplicate the package.

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-lock.yaml scripts/copy-pdf-worker.mjs .gitignore
git commit -S -m "build: add pdfjs-dist and stage its worker into public/

Pinned exactly, because dependency-policy.test.mjs rejects a caret in
any dependency block. The worker is copied to public/ on postinstall
rather than bundled: this is the codebase's first Web Worker, and the
packaged desktop shell serves the same static tree.

Bead: cave-cbz28"
```

---

### Task 8: Viewer state machine (pure)

pdf.js cannot be exercised under `node --test` — no canvas, no `DOMMatrix`, no worker.
What *is* testable is the state machine, with the loader injected.

**Files:**
- Create: `src/lib/research-paper-view.ts`
- Test: `src/lib/research-paper-view.test.ts`
- Modify: `scripts/run-tests.mjs`

- [ ] **Step 1: Write the failing test**

Create `src/lib/research-paper-view.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { paperPdfUrl, reducePaperView, type PaperViewState } from "./research-paper-view.ts";

const idle: PaperViewState = { status: "idle", pageCount: 0, error: null };

test("builds the proxy URL", () => {
  assert.equal(paperPdfUrl("2401.12345"), "/api/research/papers/pdf?id=2401.12345");
});

test("load then ready", () => {
  const loading = reducePaperView(idle, { type: "load" });
  assert.equal(loading.status, "loading");
  const ready = reducePaperView(loading, { type: "ready", pageCount: 12 });
  assert.equal(ready.status, "ready");
  assert.equal(ready.pageCount, 12);
});

test("failure records the message and can retry", () => {
  const failed = reducePaperView({ ...idle, status: "loading" }, { type: "fail", message: "boom" });
  assert.equal(failed.status, "error");
  assert.equal(failed.error, "boom");
  assert.equal(reducePaperView(failed, { type: "load" }).status, "loading");
});

test("cancel returns to idle and clears the page count", () => {
  const ready: PaperViewState = { status: "ready", pageCount: 12, error: null };
  const cancelled = reducePaperView(ready, { type: "cancel" });
  assert.deepEqual(cancelled, idle);
});

test("a late ready after cancel is ignored", () => {
  const cancelled = reducePaperView({ status: "ready", pageCount: 3, error: null }, { type: "cancel" });
  assert.equal(reducePaperView(cancelled, { type: "ready", pageCount: 3 }).status, "idle");
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `node --experimental-strip-types --test src/lib/research-paper-view.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/research-paper-view.ts`:

```ts
export type PaperViewStatus = "idle" | "loading" | "ready" | "error";

export type PaperViewState = {
  status: PaperViewStatus;
  pageCount: number;
  error: string | null;
};

export type PaperViewAction =
  | { type: "load" }
  | { type: "ready"; pageCount: number }
  | { type: "fail"; message: string }
  | { type: "cancel" };

export const initialPaperViewState: PaperViewState = {
  status: "idle",
  pageCount: 0,
  error: null,
};

export function paperPdfUrl(arxivId: string): string {
  return `/api/research/papers/pdf?id=${encodeURIComponent(arxivId)}`;
}

export function reducePaperView(state: PaperViewState, action: PaperViewAction): PaperViewState {
  switch (action.type) {
    case "load":
      return { status: "loading", pageCount: 0, error: null };
    case "ready":
      // A render that resolves after dismissal must not revive the viewer.
      if (state.status !== "loading") return state;
      return { status: "ready", pageCount: action.pageCount, error: null };
    case "fail":
      if (state.status !== "loading") return state;
      return { status: "error", pageCount: 0, error: action.message };
    case "cancel":
      return initialPaperViewState;
  }
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `node --experimental-strip-types --test src/lib/research-paper-view.test.ts`
Expected: PASS, 5 tests.

Note the "late ready after cancel" test drives the `state.status !== "loading"` guards —
without them a resolved render would repopulate a dismissed viewer.

- [ ] **Step 5: Register and commit**

Add `"src/lib/research-paper-view.test.ts",` to the `app:` array (no `ALIAS_LOADER`; the
module has no imports).

```bash
git add src/lib/research-paper-view.ts src/lib/research-paper-view.test.ts scripts/run-tests.mjs
git commit -S -m "feat(research): paper viewer state machine

Pure and testable under node --test, which has no canvas or worker. The
ready/fail transitions are guarded on 'loading' so a render resolving
after dismissal cannot revive a closed viewer.

Bead: cave-cbz28"
```

---

### Task 9: The viewer component

**Files:**
- Create: `src/components/research-paper-viewer.tsx`
- Modify: the Research Desk resource list component that renders a `SavedLink` row

- [ ] **Step 1: Find the resource row**

Run: `grep -rln "SavedLink" src/components/ | grep -v test`
Read the component that renders link rows; that is where the Read affordance goes.

- [ ] **Step 2: Write the component**

Create `src/components/research-paper-viewer.tsx`. The load-and-render effect is the part
that goes wrong, so it is given in full:

```tsx
"use client";

import { useEffect, useReducer, useRef, useState } from "react";

import {
  initialPaperViewState,
  paperPdfUrl,
  reducePaperView,
} from "@/lib/research-paper-view";

type Props = {
  arxivId: string;
  title: string;
  authors: string[];
  abstract: string;
  publishedAt: string;
  onClose: () => void;
};

export default function ResearchPaperViewer(props: Props) {
  const [state, dispatch] = useReducer(reducePaperView, initialPaperViewState);
  const [page, setPage] = useState(1);
  const [scale, setScale] = useState(1.2);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textLayerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    let doc: Awaited<ReturnType<ReturnType<typeof import("pdfjs-dist")["getDocument"]>["promise"]>> | null = null;
    let renderTask: { cancel: () => void } | null = null;

    dispatch({ type: "load" });
    void (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        // The worker is staged into public/ by scripts/copy-pdf-worker.mjs.
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        doc = await pdfjs.getDocument(paperPdfUrl(props.arxivId)).promise;
        if (cancelled) return;
        dispatch({ type: "ready", pageCount: doc.numPages });

        const pdfPage = await doc.getPage(page);
        if (cancelled) return;
        const viewport = pdfPage.getViewport({ scale });
        const canvas = canvasRef.current;
        const context = canvas?.getContext("2d");
        if (!canvas || !context) return;
        canvas.width = viewport.width;
        canvas.height = viewport.height;

        renderTask = pdfPage.render({ canvas, canvasContext: context, viewport });
        await (renderTask as unknown as { promise: Promise<void> }).promise;
        if (cancelled) return;

        // The text layer is what makes the document selectable and searchable.
        const layer = textLayerRef.current;
        if (layer) {
          layer.replaceChildren();
          const textLayer = new pdfjs.TextLayer({
            textContentSource: await pdfPage.getTextContent(),
            container: layer,
            viewport,
          });
          await textLayer.render();
        }
      } catch (error) {
        if (cancelled) return;
        dispatch({
          type: "fail",
          message: error instanceof Error ? error.message : "could not render this paper",
        });
      }
    })();

    return () => {
      // Dismissing mid-render must not leave a worker task writing into a
      // canvas that React has already detached.
      cancelled = true;
      dispatch({ type: "cancel" });
      renderTask?.cancel();
      void doc?.destroy();
    };
  }, [props.arxivId, page, scale]);

  // …dialog chrome: header (title, authors, formatted publishedAt), abstract,
  // <canvas ref={canvasRef} /> with <div ref={textLayerRef} /> positioned over
  // it, page prev/next bound to setPage within 1..state.pageCount, zoom bound
  // to setScale, links out to the HF page and arXiv, download, and a close
  // button calling props.onClose.
  return null; // replace with the chrome above
}
```

Structure the dialog chrome after `src/components/chat-artifact-viewer.tsx` — same dialog
role, same dismissal behaviour. Use design tokens for every colour and spacing value;
`pnpm lint` runs `codemod:design:check` over `src/components/**` and a raw literal fails
the build.

Note the effect depends on `page` and `scale`, so changing either re-runs it and the
cleanup cancels the in-flight render first. That is deliberate: it is what stops a fast
page-flip from racing two renders onto one canvas.

- [ ] **Step 3: Mount it client-only**

Wherever the viewer is opened, import it with:

```ts
const ResearchPaperViewer = dynamic(() => import("@/components/research-paper-viewer"), {
  ssr: false,
});
```

pdf.js touches `DOMMatrix` and canvas, neither of which exists during SSR.

- [ ] **Step 4: Add the Read affordance**

In the resource row, when `link.category === "paper" && link.paper?.arxivId`, render a
"Read" button that opens the viewer with that link's metadata. When `link.paper` is
absent — an arXiv or DOI link saved before this change, or one whose metadata fetch
degraded — render exactly as today, with no Read button, because there is no id to stream.

- [ ] **Step 5: Verify lint and types**

Run: `pnpm lint && pnpm typecheck`
Expected: both pass. A design-token failure names the offending literal.

- [ ] **Step 6: Commit**

```bash
git add src/components/research-paper-viewer.tsx src/components
git commit -S -m "feat(research): render papers with pdf.js

Canvas per page with the text layer over it, so the document can be
selected and searched rather than merely displayed. Dynamically imported
and ssr:false — pdf.js needs DOMMatrix and canvas — which also keeps it
out of the main bundle for anyone who never opens a paper.

Bead: cave-cbz28"
```

---

### Task 10: End-to-end coverage

**Files:**
- Create: `tests/research-paper-viewer.spec.ts`
- Create: `tests/fixtures/sample-paper.pdf`

- [ ] **Step 1: Add the fixture**

Create a one-page PDF containing the literal text `HYPERSPECTRAL FIXTURE` at
`tests/fixtures/sample-paper.pdf`. Any tool works; keep it under ~10 KB. Commit it — the
mock must serve real PDF bytes, because **pdf.js parses what it is handed and a stub body
fails at the parser**, proving nothing.

- [ ] **Step 2: Write the spec**

Create `tests/research-paper-viewer.spec.ts`. It must:

- `page.addInitScript` setting `cave:onboarding:dismissed=1` — Playwright is daemon-less
- `page.route("**/api/research/links**", …)` returning one saved link:
  `{ id: "l1", url: "https://huggingface.co/papers/2401.12345", category: "paper", title: "Fixture Paper", addedAt: <iso>, source: "desk", paper: { arxivId: "2401.12345", authors: ["A. Author"], abstract: "An abstract.", publishedAt: "2024-01-22T00:00:00.000Z" } }`
- `page.route("**/api/research/papers/pdf**", …)` fulfilling with
  `{ status: 200, contentType: "application/pdf", body: readFileSync("tests/fixtures/sample-paper.pdf") }`
- navigate to the Research Desk, open the resource, click **Read**
- assert the viewer dialog is visible and shows the title and authors
- assert a page canvas rendered: `await expect(dialog.locator("canvas").first()).toBeVisible()`
- assert the text layer carries the fixture text: `await expect(dialog.getByText("HYPERSPECTRAL FIXTURE")).toBeVisible()`

**Both new endpoints must be mocked.** On 2026-08-14 #4634 added a route, made a player
conditional on it, shipped no mock, and left `main` red for hours — blocking every PR
touching `src/**`, since those classify `e2e: true` (`cave-1kv8i`).

- [ ] **Step 3: Run it**

Run: `COVEN_CAVE_E2E=1 pnpm exec playwright test tests/research-paper-viewer.spec.ts --project=desktop`
Expected: PASS.

- [ ] **Step 4: Confirm the desktop project actually collected it**

Run: `COVEN_CAVE_E2E=1 pnpm exec playwright test tests/research-paper-viewer.spec.ts --project=desktop --list`
Expected: the spec is listed. A green run that collected **zero** tests is not a pass —
that failure mode cost a full debugging cycle on `cave-3wmla`.

- [ ] **Step 5: Commit**

```bash
git add tests/research-paper-viewer.spec.ts tests/fixtures/sample-paper.pdf
git commit -S -m "test(research): e2e for the pdf.js paper viewer

Mocks both new endpoints and serves a real one-page fixture PDF, because
pdf.js parses what it is handed and a stub body would fail at the parser
rather than exercise the viewer. Asserts the canvas renders and the text
layer carries the fixture text, which is what proves selection and search
have something to work with.

Bead: cave-cbz28"
```

---

## Final verification

- [ ] `pnpm lint`
- [ ] `pnpm typecheck`
- [ ] `pnpm test:app`
- [ ] `pnpm test:api`
- [ ] `COVEN_CAVE_E2E=1 pnpm exec playwright test --project=desktop`
- [ ] `pnpm build`
- [ ] Push, open a PR against `main`, and wait for the required `Frontend build` check.
      Do not merge with `--admin`; fix the blocker instead.
