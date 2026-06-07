# Familiar-driven link routing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire familiars to auto-capture URLs from chat / browser / `/save` and route them into Bookmarks, Reading, or GitHub lists with full source attribution, surfaced in a new unified Library timeline.

**Architecture:** Four ingestion adapters share one server-side `POST /api/library/route-link` endpoint. A pure five-tier classifier decides the list; a (later-phase) familiar fallback handles ambiguous hosts. A new dedup index makes adapters retry-safe. The existing per-list JSON files and component tabs remain untouched; the new "All" timeline reads across them via a new `GET /api/library/all`.

**Tech Stack:** Next.js 16 (App Router) + Tailwind v4 + TypeScript 5. Tests via `node --test --experimental-strip-types` against `.test.ts` files alongside source. Phosphor icons via `@iconify-json/ph`. Existing primitives (`Modal`, `IconButton`, `ViewHeader`, `EmptyState`, `Skeleton`, `Popover`, `SearchInput`) from the design-system uplift in commit `e24f879`.

**Branch:** Work on `feat/familiar-link-routing` off `main`. Every commit signed with `-S`.

---

## Pre-flight

- [ ] **Step 0.1: Create the feature branch**

```bash
git checkout main
git pull origin main --ff-only
git checkout -b feat/familiar-link-routing
```

- [ ] **Step 0.2: Confirm signing config**

```bash
git config --get user.signingkey
git config --get gpg.format
```
Expected: both return non-empty. If either is empty, STOP and ask the user to configure.

- [ ] **Step 0.3: Baseline typecheck + tests**

```bash
pnpm typecheck
node --test --experimental-strip-types src/lib/*.test.ts src/components/*.test.ts 2>&1 | tail -10
```
Expected: typecheck clean. Tests: the existing `agents-view.test.ts` failure (pre-existing, "Search agents…" vs "Search chats…") is the ONLY allowed failure. Record the pass/fail counts.

---

## File structure (decomposition lock-in)

**New files (16):**

| Path | Purpose |
|---|---|
| `src/lib/library-types.ts` *(extend)* | Add `LinkSource`, `LinkCapture`; optional `capture` on item types |
| `src/lib/library-store.ts` | Extracted JSON file helpers + in-memory mutex; dedup-index read/write |
| `src/lib/link-extractor.ts` | Pure: `(text) → URL[]`. Strips code blocks, image targets, localhost/file |
| `src/lib/link-extractor.test.ts` | Fixture-table tests |
| `src/lib/link-classifier.ts` | Pure: `(url) → ClassifyResult`. Five-tier rule table |
| `src/lib/link-classifier.test.ts` | Fixture-table tests |
| `src/lib/slash-save-parser.ts` | Pure: `(args: string) → { url, listHint?, tags } \| { error }` |
| `src/lib/slash-save-parser.test.ts` | Fixture-table tests |
| `src/lib/familiar-classify.ts` | Async: harness call for Tier-5 fallback. (Phase 7) |
| `src/lib/familiar-classify.test.ts` | Mocked-harness tests |
| `src/lib/feed-adapter.ts` | Stub: type export + `not_implemented` function body |
| `src/app/api/library/route-link/route.ts` | New POST endpoint |
| `src/app/api/library/route-link/route.test.ts` | Integration test against tmp dir |
| `src/app/api/library/all/route.ts` | New GET unified-timeline endpoint |
| `src/components/library-timeline.tsx` | Owns the All tab — toolbar + grouping state |
| `src/components/library-timeline-row.tsx` | Row template (used in both groupings) |
| `src/components/library-timeline.test.ts` | Wiring test (regex source) |
| `src/components/browser-pane-save.test.ts` | Wiring test (regex source) |
| `src/components/chat-send-routes-links.test.ts` | Wiring test (regex source) |

**Modified files:**

| Path | Change |
|---|---|
| `src/lib/library-types.ts` | Add `LinkSource`, `LinkCapture`; extend item types with optional `capture` |
| `src/lib/slash-commands.ts` | Add `/save` entry |
| `src/app/api/library/bookmarks/route.ts` | Use `library-store`; accept `capture`/`familiar`; drop hardcoded `"sage"` |
| `src/app/api/library/reading/route.ts` | Same |
| `src/app/api/library/github/route.ts` | Same; export `parseGitHubUrl` for `link-classifier` |
| `src/app/api/chat/send/route.ts` | Add fire-and-forget `routeLink` calls for prompt + assistant text |
| `src/components/browser-pane.tsx` | Add Save `<IconButton>` in toolbar |
| `src/components/library-view.tsx` | Add `"all"` to section union; make it the default; mount `<LibraryTimeline>` |
| `src/components/library-collection-rail.tsx` | Show "All" first in the section list |
| `src/components/chat-view.tsx` *(or composer)* | Wire `/save` slash dispatcher to call `routeLink` |

**Storage layout (unchanged on disk):**
```
~/.openclaw/workspace/sage/library/
├── bookmarks.json     (existing)
├── reading.json       (existing)
├── github.json        (existing)
└── .index.json        (new — dedup triples)
```

---

## Phase 1 — Schema + storage refactor

Goal: type system supports the new `capture` field; the three existing endpoints share one storage module. Zero behavior change for end users; all existing tests still pass.

### Task 1: Extend `library-types.ts` with `LinkSource` + `LinkCapture`

**Files:**
- Modify: `src/lib/library-types.ts`

- [ ] **Step 1.1: Append the new types**

Append to `src/lib/library-types.ts`:

```ts
// ── Link routing (familiar-driven ingestion) ────────────────────
export type LinkSource =
  | { kind: "chat";    sessionId: string; turnId: string; chatTitle: string }
  | { kind: "browser"; tabUrl: string; tabTitle: string }
  | { kind: "slash";   originSessionId: string | null }
  | { kind: "feed";    feedId: string; feedTitle: string }
  | { kind: "manual" };

export type LinkCaptureRule =
  | "github"
  | "paper-host"
  | "video-host"
  | "article-host"
  | "default-bookmark"
  | "familiar-fallback";

export type LinkCapture = {
  source: LinkSource;
  familiar: string;
  capturedAt: string;
  classifier: { rule: LinkCaptureRule; confidence: "high" | "low" };
};
```

- [ ] **Step 1.2: Add optional `capture` to each item type**

Edit the three existing exported types in the same file. For each, add `capture?: LinkCapture;` as a new field. Example for `LibraryBookmark`:

```ts
export type LibraryBookmark = {
  id: string;
  url: string;
  title: string;
  domain: string;
  favicon?: string;
  notes?: string;
  tags: string[];
  savedAt: string;
  familiar: string;
  capture?: LinkCapture;  // NEW
};
```

Do the same for `LibraryReadingItem` and `LibraryGitHubItem`.

- [ ] **Step 1.3: Typecheck**

```bash
pnpm typecheck
```
Expected: clean. The `capture` field is optional so no consumer breaks.

- [ ] **Step 1.4: Commit**

```bash
git add src/lib/library-types.ts
git commit -S -m "feat(library): add LinkSource + LinkCapture types

Optional capture field on every item type. Backward-compatible:
items already on disk lack capture and render with manual badge.
Sets up familiar-driven link routing (spec 2026-06-06)."
```

### Task 2: Extract storage helpers into `library-store.ts`

**Files:**
- Create: `src/lib/library-store.ts`
- Create: `src/lib/library-store.test.ts`

- [ ] **Step 2.1: Write the failing test**

Create `src/lib/library-store.test.ts`:

```ts
// @ts-nocheck
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createLibraryStore } from "./library-store.ts";

const root = await mkdtemp(path.join(tmpdir(), "lib-store-"));
const store = createLibraryStore(root);

// fresh store reports empty
assert.deepStrictEqual(await store.readBookmarks(), []);
assert.deepStrictEqual(await store.readReading(), []);
assert.deepStrictEqual(await store.readGithub(), []);
assert.deepStrictEqual(await store.readIndex(), { version: 1, entries: [] });

// append bookmark + read back
const bm = { id: "bm_1", url: "https://a.com", title: "A", domain: "a.com", tags: [], savedAt: "2026-06-06T00:00:00Z", familiar: "cody" };
await store.appendBookmark(bm);
assert.deepStrictEqual(await store.readBookmarks(), [bm]);

// dedup index roundtrip
await store.appendIndexEntry({ url: "https://a.com", sessionId: null, turnId: null, list: "bookmarks", itemId: "bm_1" });
const idx = await store.readIndex();
assert.equal(idx.entries.length, 1);
assert.equal(idx.entries[0].itemId, "bm_1");

// hasIndexEntry
assert.equal(await store.hasIndexEntry("https://a.com", null, null), true);
assert.equal(await store.hasIndexEntry("https://b.com", null, null), false);

await rm(root, { recursive: true, force: true });
```

- [ ] **Step 2.2: Run it to verify it fails**

```bash
node --test --experimental-strip-types src/lib/library-store.test.ts 2>&1 | tail -5
```
Expected: FAIL with `Cannot find module ./library-store.ts`.

- [ ] **Step 2.3: Implement `library-store.ts`**

Create `src/lib/library-store.ts`:

```ts
import fs from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";
import type { LibraryBookmark, LibraryReadingItem, LibraryGitHubItem } from "./library-types";

export type IndexEntry = {
  url: string;
  sessionId: string | null;
  turnId: string | null;
  list: "bookmarks" | "reading" | "github";
  itemId: string;
};
export type LibraryIndex = { version: 1; entries: IndexEntry[] };

const DEFAULT_ROOT = path.join(homedir(), ".openclaw", "workspace", "sage", "library");

type Mutex = { p: Promise<void> };
const mutex: Mutex = { p: Promise.resolve() };

function runExclusive<T>(fn: () => Promise<T>): Promise<T> {
  const next = mutex.p.then(fn, fn);
  mutex.p = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

async function readJson<T>(p: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(p, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJsonAtomic(p: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2), "utf-8");
  await fs.rename(tmp, p);
}

export function createLibraryStore(root: string = DEFAULT_ROOT) {
  const paths = {
    bookmarks: path.join(root, "bookmarks.json"),
    reading: path.join(root, "reading.json"),
    github: path.join(root, "github.json"),
    index: path.join(root, ".index.json"),
  };

  const emptyIndex: LibraryIndex = { version: 1, entries: [] };

  return {
    readBookmarks: () => readJson<LibraryBookmark[]>(paths.bookmarks, []),
    readReading: () => readJson<LibraryReadingItem[]>(paths.reading, []),
    readGithub: () => readJson<LibraryGitHubItem[]>(paths.github, []),
    readIndex: () => readJson<LibraryIndex>(paths.index, emptyIndex),

    appendBookmark: (item: LibraryBookmark) =>
      runExclusive(async () => {
        const items = await readJson<LibraryBookmark[]>(paths.bookmarks, []);
        items.push(item);
        await writeJsonAtomic(paths.bookmarks, items);
      }),

    appendReading: (item: LibraryReadingItem) =>
      runExclusive(async () => {
        const items = await readJson<LibraryReadingItem[]>(paths.reading, []);
        items.push(item);
        await writeJsonAtomic(paths.reading, items);
      }),

    appendGithub: (item: LibraryGitHubItem) =>
      runExclusive(async () => {
        const items = await readJson<LibraryGitHubItem[]>(paths.github, []);
        items.push(item);
        await writeJsonAtomic(paths.github, items);
      }),

    appendIndexEntry: (entry: IndexEntry) =>
      runExclusive(async () => {
        const idx = await readJson<LibraryIndex>(paths.index, emptyIndex);
        idx.entries.push(entry);
        await writeJsonAtomic(paths.index, idx);
      }),

    hasIndexEntry: async (
      url: string,
      sessionId: string | null,
      turnId: string | null,
    ) => {
      const idx = await readJson<LibraryIndex>(paths.index, emptyIndex);
      return idx.entries.some(
        (e) => e.url === url && e.sessionId === sessionId && e.turnId === turnId,
      );
    },

    deleteById: (
      list: "bookmarks" | "reading" | "github",
      id: string,
    ) =>
      runExclusive(async () => {
        const p = paths[list];
        const items = await readJson<any[]>(p, []);
        await writeJsonAtomic(p, items.filter((i) => i.id !== id));
      }),

    paths,
  };
}

export type LibraryStore = ReturnType<typeof createLibraryStore>;
```

- [ ] **Step 2.4: Run the test**

```bash
node --test --experimental-strip-types src/lib/library-store.test.ts 2>&1 | tail -5
```
Expected: PASS.

- [ ] **Step 2.5: Typecheck**

```bash
pnpm typecheck
```
Expected: clean.

- [ ] **Step 2.6: Commit**

```bash
git add src/lib/library-store.ts src/lib/library-store.test.ts
git commit -S -m "feat(library): extract storage into library-store

Atomic writes (write-then-rename), in-memory mutex shared across
all three lists + the new dedup index, configurable root so tests
can target a tmp dir."
```

### Task 3: Refactor the three existing routes to use `library-store`

**Files:**
- Modify: `src/app/api/library/bookmarks/route.ts`
- Modify: `src/app/api/library/reading/route.ts`
- Modify: `src/app/api/library/github/route.ts`

- [ ] **Step 3.1: Refactor `bookmarks/route.ts`**

Replace the contents of `src/app/api/library/bookmarks/route.ts` with:

```ts
import { NextRequest, NextResponse } from "next/server";
import { createLibraryStore } from "@/lib/library-store";
import type { LibraryBookmark, LinkCapture } from "@/lib/library-types";

const store = createLibraryStore();

function domainFrom(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); }
  catch { return url; }
}

function generateId(): string {
  return `bm_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export async function GET() {
  const items = (await store.readBookmarks()).slice().sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1));
  return NextResponse.json({ ok: true, items });
}

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    url: string;
    title?: string;
    notes?: string;
    tags?: string[];
    familiar?: string;
    capture?: LinkCapture;
  };
  if (!body.url) return NextResponse.json({ ok: false, error: "url required" }, { status: 400 });

  const domain = domainFrom(body.url);
  const item: LibraryBookmark = {
    id: generateId(),
    url: body.url,
    title: body.title ?? domain,
    domain,
    notes: body.notes,
    tags: body.tags ?? [],
    savedAt: new Date().toISOString(),
    familiar: body.capture?.familiar ?? body.familiar ?? "sage",
    capture: body.capture,
  };

  try { await store.appendBookmark(item); }
  catch { return NextResponse.json({ ok: false, error: "write failed" }, { status: 500 }); }
  return NextResponse.json({ ok: true, item });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
  try { await store.deleteById("bookmarks", id); }
  catch { return NextResponse.json({ ok: false, error: "write failed" }, { status: 500 }); }
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3.2: Refactor `reading/route.ts`**

Replace contents of `src/app/api/library/reading/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { createLibraryStore } from "@/lib/library-store";
import type { LibraryReadingItem, ReadingStatus, LinkCapture } from "@/lib/library-types";

const store = createLibraryStore();

function generateId(): string {
  return `rd_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export async function GET() {
  const items = (await store.readReading()).slice().sort((a, b) => (a.addedAt < b.addedAt ? 1 : -1));
  return NextResponse.json({ ok: true, items });
}

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    title: string;
    url?: string;
    author?: string;
    sourceType?: LibraryReadingItem["sourceType"];
    status?: ReadingStatus;
    notes?: string;
    tags?: string[];
    familiar?: string;
    capture?: LinkCapture;
  };
  if (!body.title) return NextResponse.json({ ok: false, error: "title required" }, { status: 400 });

  const item: LibraryReadingItem = {
    id: generateId(),
    title: body.title,
    url: body.url,
    author: body.author,
    sourceType: body.sourceType ?? "article",
    status: body.status ?? "want-to-read",
    notes: body.notes,
    tags: body.tags ?? [],
    addedAt: new Date().toISOString(),
    familiar: body.capture?.familiar ?? body.familiar ?? "sage",
    capture: body.capture,
  };

  try { await store.appendReading(item); }
  catch { return NextResponse.json({ ok: false, error: "write failed" }, { status: 500 }); }
  return NextResponse.json({ ok: true, item });
}

export async function PATCH(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });

  const patch = await req.json() as Partial<LibraryReadingItem>;
  const items = await store.readReading();
  const idx = items.findIndex((i) => i.id === id);
  if (idx === -1) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });

  if (patch.status === "done" && items[idx].status !== "done") {
    patch.finishedAt = new Date().toISOString();
  }

  items[idx] = { ...items[idx], ...patch, id };
  // Rewrite the full file via deleteById + appendReading pattern:
  try {
    await store.deleteById("reading", id);
    await store.appendReading(items[idx]);
  } catch { return NextResponse.json({ ok: false, error: "write failed" }, { status: 500 }); }
  return NextResponse.json({ ok: true, item: items[idx] });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
  try { await store.deleteById("reading", id); }
  catch { return NextResponse.json({ ok: false, error: "write failed" }, { status: 500 }); }
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3.3: Refactor `github/route.ts` AND export `parseGitHubUrl`**

Replace contents of `src/app/api/library/github/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { createLibraryStore } from "@/lib/library-store";
import type { LibraryGitHubItem, GitHubItemKind, LinkCapture } from "@/lib/library-types";
import { parseGitHubUrl } from "@/lib/link-classifier";

const store = createLibraryStore();

function generateId(): string {
  return `gh_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export async function GET() {
  const items = (await store.readGithub()).slice().sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1));
  return NextResponse.json({ ok: true, items });
}

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    repo?: string;
    kind?: GitHubItemKind;
    number?: number;
    title: string;
    url: string;
    state?: LibraryGitHubItem["state"];
    labels?: string[];
    notes?: string;
    familiar?: string;
    capture?: LinkCapture;
  };
  if (!body.url) return NextResponse.json({ ok: false, error: "url required" }, { status: 400 });
  if (!body.title) return NextResponse.json({ ok: false, error: "title required" }, { status: 400 });

  const parsed = parseGitHubUrl(body.url);
  const repo = body.repo ?? parsed?.repo ?? "";
  const kind: GitHubItemKind = body.kind ?? parsed?.kind ?? "repo";
  const number = body.number ?? parsed?.number;

  const item: LibraryGitHubItem = {
    id: generateId(),
    kind,
    repo,
    number,
    title: body.title,
    url: body.url,
    state: body.state,
    labels: body.labels ?? [],
    notes: body.notes,
    savedAt: new Date().toISOString(),
    familiar: body.capture?.familiar ?? body.familiar ?? "sage",
    capture: body.capture,
  };

  try { await store.appendGithub(item); }
  catch { return NextResponse.json({ ok: false, error: "write failed" }, { status: 500 }); }
  return NextResponse.json({ ok: true, item });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
  try { await store.deleteById("github", id); }
  catch { return NextResponse.json({ ok: false, error: "write failed" }, { status: 500 }); }
  return NextResponse.json({ ok: true });
}
```

NOTE: `parseGitHubUrl` will be defined in Task 5 (`link-classifier.ts`). Until then, typecheck will fail on this file. That's expected — proceed to Task 4 / 5 then return here.

- [ ] **Step 3.4: Skip typecheck until Task 5 lands**

The github route imports from `link-classifier` which doesn't exist yet. Continue to the next phase; we'll verify typecheck after Task 5.

- [ ] **Step 3.5: Stage the changes (DO NOT commit yet)**

```bash
git add src/app/api/library/bookmarks/route.ts src/app/api/library/reading/route.ts src/app/api/library/github/route.ts
```
Commit happens at the end of Task 5 once the import resolves.

---

## Phase 2 — Pure functions + tests

### Task 4: `link-extractor.ts` + tests

**Files:**
- Create: `src/lib/link-extractor.ts`
- Create: `src/lib/link-extractor.test.ts`

- [ ] **Step 4.1: Write the failing test**

Create `src/lib/link-extractor.test.ts`:

```ts
// @ts-nocheck
import assert from "node:assert/strict";
import { extractLinks } from "./link-extractor.ts";

const CASES = [
  // happy path
  ["check https://github.com/foo/bar for context", ["https://github.com/foo/bar"]],
  ["two links: https://a.com and https://b.com", ["https://a.com/", "https://b.com/"]],

  // dedup within input
  ["https://a.com twice https://a.com", ["https://a.com/"]],

  // fenced code blocks ignored
  ["check ```\nhttps://example.com/in-code\n```", []],
  ["check ```ts\nfetch('https://example.com/in-code')\n``` and https://outside.com",
    ["https://outside.com/"]],

  // inline backticks ignored
  ["inline `https://example.com/in-backticks`", []],
  ["but `inline` then https://real.com/x", ["https://real.com/x"]],

  // image targets ignored
  ["![alt](https://cdn.example.com/img.png)", []],
  ["text ![a](https://cdn.example.com/img.png) then https://real.com",
    ["https://real.com/"]],

  // localhost / file / non-http rejected
  ["see http://localhost:3000", []],
  ["see http://127.0.0.1:8080", []],
  ["file:///etc/passwd", []],
  ["ftp://files.example.com/x", []],

  // mailto / tel skipped
  ["mailto:foo@bar.com tel:+15555555", []],

  // empty
  ["", []],
  ["no links here at all", []],
];

for (const [input, expected] of CASES) {
  const got = extractLinks(input);
  assert.deepStrictEqual(got, expected, `extractLinks(${JSON.stringify(input)}) → ${JSON.stringify(got)}; want ${JSON.stringify(expected)}`);
}

console.log(`extractLinks: ${CASES.length} cases passed`);
```

- [ ] **Step 4.2: Run it — expect FAIL**

```bash
node --test --experimental-strip-types src/lib/link-extractor.test.ts 2>&1 | tail -5
```
Expected: FAIL `Cannot find module ./link-extractor.ts`.

- [ ] **Step 4.3: Implement `link-extractor.ts`**

Create `src/lib/link-extractor.ts`:

```ts
// Pure URL extraction from arbitrary text. Skips code blocks (fenced and
// inline backticks), markdown image targets, and non-http(s) schemes.

const FENCED_CODE = /```[\s\S]*?```/g;
const INLINE_CODE = /`[^`\n]*`/g;
const IMAGE_TARGET = /!\[[^\]]*\]\([^)]*\)/g;

const URL_RE = /https?:\/\/[^\s)\]>'"`]+/g;

const REJECT_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

export function extractLinks(text: string): string[] {
  if (!text) return [];

  // Strip fenced code blocks, inline backticks, image targets BEFORE scanning.
  const cleaned = text
    .replace(FENCED_CODE, " ")
    .replace(IMAGE_TARGET, " ")
    .replace(INLINE_CODE, " ");

  const found = cleaned.match(URL_RE) ?? [];

  const out: string[] = [];
  const seen = new Set<string>();

  for (const raw of found) {
    // Trim trailing punctuation that URL_RE may have included.
    const trimmed = raw.replace(/[.,;:!?]+$/, "");
    let url: URL;
    try { url = new URL(trimmed); } catch { continue; }
    if (url.protocol !== "http:" && url.protocol !== "https:") continue;
    if (REJECT_HOSTS.has(url.hostname)) continue;
    const normalized = url.toString();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }

  return out;
}
```

- [ ] **Step 4.4: Run the test**

```bash
node --test --experimental-strip-types src/lib/link-extractor.test.ts 2>&1 | tail -5
```
Expected: PASS. Prints `extractLinks: 16 cases passed`.

- [ ] **Step 4.5: Commit**

```bash
git add src/lib/link-extractor.ts src/lib/link-extractor.test.ts
git commit -S -m "feat(library): link-extractor pure function

(text) -> URL[]. Strips fenced code blocks, inline backticks,
image targets, localhost/file/non-http URLs. Dedup-within-input.
16 fixture cases."
```

### Task 5: `link-classifier.ts` + tests (the heart of the routing)

**Files:**
- Create: `src/lib/link-classifier.ts`
- Create: `src/lib/link-classifier.test.ts`

- [ ] **Step 5.1: Write the failing test**

Create `src/lib/link-classifier.test.ts`:

```ts
// @ts-nocheck
import assert from "node:assert/strict";
import { classifyLink, parseGitHubUrl } from "./link-classifier.ts";

const CLASSIFY_CASES = [
  // Tier 1 — github
  ["https://github.com/foo/bar",                  { list: "github", rule: "github" }],
  ["https://github.com/foo/bar/issues/12",        { list: "github", rule: "github" }],
  ["https://github.com/foo/bar/pull/45",          { list: "github", rule: "github" }],
  ["https://gist.github.com/foo/abc",             { list: "github", rule: "github" }],
  ["HTTPS://GITHUB.COM/FOO/BAR",                  { list: "github", rule: "github" }],
  ["https://github.com/foo/bar?ref=x",            { list: "github", rule: "github" }],

  // Tier 2 — papers
  ["https://arxiv.org/abs/2603.12345",            { list: "reading", readingKind: "paper", rule: "paper-host" }],
  ["https://openreview.net/forum?id=abc",         { list: "reading", readingKind: "paper", rule: "paper-host" }],

  // Tier 3 — videos
  ["https://youtu.be/dQw4w9WgXcQ",                { list: "reading", readingKind: "video", rule: "video-host" }],
  ["https://www.youtube.com/watch?v=abc",         { list: "reading", readingKind: "video", rule: "video-host" }],
  ["https://vimeo.com/12345",                     { list: "reading", readingKind: "video", rule: "video-host" }],

  // Tier 4 — articles
  ["https://blog.cloudflare.com/foo",             { list: "reading", readingKind: "article", rule: "article-host" }],
  ["https://example.substack.com/p/hello",        { list: "reading", readingKind: "article", rule: "article-host" }],
  ["https://medium.com/@author/post",             { list: "reading", readingKind: "article", rule: "article-host" }],
  ["https://dev.to/foo/bar",                      { list: "reading", readingKind: "article", rule: "article-host" }],
  ["https://example.com/blog/post-1",             { list: "reading", readingKind: "article", rule: "article-host" }],
  ["https://example.com/articles/x",              { list: "reading", readingKind: "article", rule: "article-host" }],

  // Tier 5 — ambiguous hosts trigger familiar fallback
  ["https://twitter.com/foo/status/1",            { rule: "familiar-fallback" }],
  ["https://x.com/foo/status/1",                  { rule: "familiar-fallback" }],
  ["https://news.ycombinator.com/item?id=1",      { rule: "familiar-fallback" }],
  ["https://reddit.com/r/foo/comments/1/x",       { rule: "familiar-fallback" }],

  // Default — bookmark
  ["https://docs.python.org/3/",                  { list: "bookmarks", rule: "default-bookmark" }],
  ["https://example.com",                         { list: "bookmarks", rule: "default-bookmark" }],
  ["https://example.com/tools/foo",               { list: "bookmarks", rule: "default-bookmark" }],
];

for (const [url, want] of CLASSIFY_CASES) {
  const got = classifyLink(url);
  for (const key of Object.keys(want)) {
    assert.equal(got[key], want[key], `classifyLink(${url}).${key} = ${got[key]}; want ${want[key]}`);
  }
}

// parseGitHubUrl coverage
assert.deepStrictEqual(parseGitHubUrl("https://github.com/foo/bar"), { repo: "foo/bar", kind: "repo" });
assert.deepStrictEqual(parseGitHubUrl("https://github.com/foo/bar/issues/12"), { repo: "foo/bar", kind: "issue", number: 12 });
assert.deepStrictEqual(parseGitHubUrl("https://github.com/foo/bar/pull/45"), { repo: "foo/bar", kind: "pr", number: 45 });
assert.deepStrictEqual(parseGitHubUrl("https://github.com/foo/bar/discussions/9"), { repo: "foo/bar", kind: "discussion", number: 9 });
assert.equal(parseGitHubUrl("https://example.com/foo/bar"), null);

console.log(`classifyLink: ${CLASSIFY_CASES.length} cases + parseGitHubUrl: 5 cases passed`);
```

- [ ] **Step 5.2: Run it — expect FAIL**

```bash
node --test --experimental-strip-types src/lib/link-classifier.test.ts 2>&1 | tail -5
```
Expected: FAIL `Cannot find module ./link-classifier.ts`.

- [ ] **Step 5.3: Implement `link-classifier.ts`**

Create `src/lib/link-classifier.ts`:

```ts
import type { GitHubItemKind } from "./library-types";

export type ClassifyList = "github" | "reading" | "bookmarks";
export type ClassifyRule =
  | "github"
  | "paper-host"
  | "video-host"
  | "article-host"
  | "default-bookmark"
  | "familiar-fallback";

export type ClassifyResult = {
  list?: ClassifyList;
  readingKind?: "article" | "paper" | "video" | "thread";
  githubParse?: { repo: string; kind: GitHubItemKind; number?: number };
  rule: ClassifyRule;
  confidence: "high" | "low";
};

const PAPER_HOSTS = new Set([
  "arxiv.org",
  "paperswithcode.com",
  "nature.com",
  "sciencemag.org",
  "aclanthology.org",
  "openreview.net",
  "semanticscholar.org",
]);

const VIDEO_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "youtu.be",
  "vimeo.com",
  "www.vimeo.com",
  "loom.com",
]);

const ARTICLE_HOST_SUFFIXES = [".substack.com", ".medium.com"];
const ARTICLE_HOSTS = new Set(["medium.com", "dev.to", "hashnode.dev"]);
const AMBIGUOUS_HOSTS = new Set([
  "twitter.com",
  "www.twitter.com",
  "x.com",
  "www.x.com",
  "news.ycombinator.com",
  "reddit.com",
  "www.reddit.com",
  "old.reddit.com",
]);

function isGithubHost(host: string): boolean {
  return host === "github.com" || host === "www.github.com" || host.endsWith(".github.com");
}

export function parseGitHubUrl(
  url: string,
): { repo: string; kind: GitHubItemKind; number?: number } | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (!isGithubHost(u.hostname.toLowerCase())) return null;
  const parts = u.pathname.replace(/^\//, "").split("/");
  if (parts.length < 2) return null;
  const repo = `${parts[0]}/${parts[1]}`;
  if (parts.length === 2) return { repo, kind: "repo" };
  if (parts[2] === "issues" && parts[3]) return { repo, kind: "issue", number: parseInt(parts[3], 10) };
  if (parts[2] === "pull" && parts[3]) return { repo, kind: "pr", number: parseInt(parts[3], 10) };
  if (parts[2] === "discussions" && parts[3]) return { repo, kind: "discussion", number: parseInt(parts[3], 10) };
  return { repo, kind: "repo" };
}

function isArticleHost(host: string): boolean {
  if (ARTICLE_HOSTS.has(host)) return true;
  for (const suffix of ARTICLE_HOST_SUFFIXES) if (host.endsWith(suffix)) return true;
  if (host.startsWith("blog.")) return true;
  return false;
}

function isArticlePath(pathname: string): boolean {
  return /\/(blog|posts|articles)\//.test(pathname);
}

export function classifyLink(url: string): ClassifyResult {
  let u: URL;
  try { u = new URL(url); } catch { return { rule: "default-bookmark", confidence: "low", list: "bookmarks" }; }
  const host = u.hostname.toLowerCase();

  // Tier 1
  if (isGithubHost(host)) {
    return {
      list: "github",
      rule: "github",
      confidence: "high",
      githubParse: parseGitHubUrl(url) ?? undefined,
    };
  }

  // Tier 2
  if (PAPER_HOSTS.has(host)) return { list: "reading", readingKind: "paper", rule: "paper-host", confidence: "high" };

  // Tier 3
  if (VIDEO_HOSTS.has(host)) return { list: "reading", readingKind: "video", rule: "video-host", confidence: "high" };

  // Tier 4
  if (isArticleHost(host) || isArticlePath(u.pathname)) {
    return { list: "reading", readingKind: "article", rule: "article-host", confidence: "high" };
  }

  // Tier 5 — caller awaits familiar fallback
  if (AMBIGUOUS_HOSTS.has(host)) return { rule: "familiar-fallback", confidence: "low" };

  // Default
  return { list: "bookmarks", rule: "default-bookmark", confidence: "low" };
}
```

- [ ] **Step 5.4: Run the classifier test**

```bash
node --test --experimental-strip-types src/lib/link-classifier.test.ts 2>&1 | tail -5
```
Expected: PASS.

- [ ] **Step 5.5: Now the github route from Task 3 also typechecks. Run typecheck**

```bash
pnpm typecheck
```
Expected: clean.

- [ ] **Step 5.6: Commit the classifier AND the Phase-1 route refactor together**

The bookmarks/reading/github route refactors from Task 3 are staged. Add the classifier files and commit:

```bash
git add src/lib/link-classifier.ts src/lib/link-classifier.test.ts
git commit -S -m "feat(library): link-classifier + storage refactor

Five-tier classifier (github / paper / video / article /
ambiguous-fallback / default-bookmark). parseGitHubUrl extracted
from the github route. The three existing list endpoints now use
library-store and accept optional capture + familiar on POST."
```

### Task 6: `slash-save-parser.ts` + tests

**Files:**
- Create: `src/lib/slash-save-parser.ts`
- Create: `src/lib/slash-save-parser.test.ts`

- [ ] **Step 6.1: Write the failing test**

Create `src/lib/slash-save-parser.test.ts`:

```ts
// @ts-nocheck
import assert from "node:assert/strict";
import { slashSaveParse } from "./slash-save-parser.ts";

const CASES = [
  ["https://a.com",                    { url: "https://a.com", listHint: undefined, tags: [] }],
  ["https://a.com reading",            { url: "https://a.com", listHint: "reading", tags: [] }],
  ["https://a.com bookmarks",          { url: "https://a.com", listHint: "bookmarks", tags: [] }],
  ["https://a.com github",             { url: "https://a.com", listHint: "github", tags: [] }],
  ["https://a.com #ai #ml",            { url: "https://a.com", listHint: undefined, tags: ["ai", "ml"] }],
  ["https://a.com reading #ai",        { url: "https://a.com", listHint: "reading", tags: ["ai"] }],
  ["  https://a.com   reading  #ai ",  { url: "https://a.com", listHint: "reading", tags: ["ai"] }],
  ["",                                 { error: "url_required" }],
  ["   ",                              { error: "url_required" }],
  ["not-a-url",                        { error: "url_required" }],
  ["reading https://a.com",            { error: "url_required" }],  // URL must be first
];

for (const [input, want] of CASES) {
  const got = slashSaveParse(input);
  assert.deepStrictEqual(got, want, `slashSaveParse(${JSON.stringify(input)})`);
}
console.log(`slashSaveParse: ${CASES.length} cases passed`);
```

- [ ] **Step 6.2: Run it — expect FAIL**

```bash
node --test --experimental-strip-types src/lib/slash-save-parser.test.ts 2>&1 | tail -5
```
Expected: FAIL.

- [ ] **Step 6.3: Implement `slash-save-parser.ts`**

Create `src/lib/slash-save-parser.ts`:

```ts
export type SlashSaveOk = {
  url: string;
  listHint?: "bookmarks" | "reading" | "github";
  tags: string[];
};
export type SlashSaveResult = SlashSaveOk | { error: "url_required" };

const VALID_HINTS = new Set(["bookmarks", "reading", "github"]);

export function slashSaveParse(args: string): SlashSaveResult {
  const trimmed = (args ?? "").trim();
  if (!trimmed) return { error: "url_required" };

  const tokens = trimmed.split(/\s+/);
  const [first, ...rest] = tokens;
  let url: URL;
  try { url = new URL(first); } catch { return { error: "url_required" }; }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { error: "url_required" };

  let listHint: SlashSaveOk["listHint"];
  const tags: string[] = [];
  for (const token of rest) {
    if (token.startsWith("#")) {
      const tag = token.slice(1);
      if (tag) tags.push(tag);
    } else if (VALID_HINTS.has(token)) {
      listHint = token as SlashSaveOk["listHint"];
    }
  }

  return { url: first, listHint, tags };
}
```

- [ ] **Step 6.4: Run the test**

```bash
node --test --experimental-strip-types src/lib/slash-save-parser.test.ts 2>&1 | tail -5
```
Expected: PASS.

- [ ] **Step 6.5: Commit**

```bash
git add src/lib/slash-save-parser.ts src/lib/slash-save-parser.test.ts
git commit -S -m "feat(library): slash-save-parser

Parses '/save <url> [bookmarks|reading|github] [#tag]'.
URL must be first token. 11 fixture cases."
```

---

## Phase 3 — `route-link` endpoint (no familiar fallback yet)

### Task 7: `feed-adapter.ts` stub

**Files:**
- Create: `src/lib/feed-adapter.ts`

- [ ] **Step 7.1: Write the stub**

Create `src/lib/feed-adapter.ts`:

```ts
import type { LinkSource } from "./library-types";

export type FeedItem = { url: string; title: string; feedId: string; feedTitle: string };

export async function routeFeedItem(_item: FeedItem, _familiar: string): Promise<never> {
  throw new Error("not_implemented: RSS / feed adapter is v2");
}

// Type-level only: the source shape v2 will populate.
export type FeedSource = Extract<LinkSource, { kind: "feed" }>;
```

- [ ] **Step 7.2: Typecheck**

```bash
pnpm typecheck
```
Expected: clean.

- [ ] **Step 7.3: Commit**

```bash
git add src/lib/feed-adapter.ts
git commit -S -m "feat(library): feed-adapter stub for v2

Exports FeedItem + FeedSource types. routeFeedItem throws
not_implemented until the v2 poller lands."
```

### Task 8: `POST /api/library/route-link` endpoint + integration test

**Files:**
- Create: `src/app/api/library/route-link/route.ts`
- Create: `src/app/api/library/route-link/route.test.ts`

- [ ] **Step 8.1: Write the failing integration test**

Create `src/app/api/library/route-link/route.test.ts`:

```ts
// @ts-nocheck
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Tests target the routeLink internal handler directly (so we don't
// need a Next.js HTTP layer in tests). The handler reads its store
// path from process.env.CAVE_LIBRARY_DIR when set.

const root = await mkdtemp(path.join(tmpdir(), "lib-rl-"));
process.env.CAVE_LIBRARY_DIR = root;

const { routeLinkHandler } = await import("./route.ts");

// 1. Github URL → github list
{
  const res = await routeLinkHandler({
    url: "https://github.com/foo/bar/pull/9",
    source: { kind: "slash", originSessionId: null },
    familiar: "cody",
  });
  assert.equal(res.ok, true);
  assert.equal(res.deduped, false);
  assert.equal(res.classify.rule, "github");
  const gh = JSON.parse(await readFile(path.join(root, "github.json"), "utf-8"));
  assert.equal(gh.length, 1);
  assert.equal(gh[0].kind, "pr");
  assert.equal(gh[0].number, 9);
  assert.equal(gh[0].capture.familiar, "cody");
  assert.equal(gh[0].capture.classifier.rule, "github");
}

// 2. arxiv URL → reading list, paper
{
  const res = await routeLinkHandler({
    url: "https://arxiv.org/abs/2603.12345",
    source: { kind: "chat", sessionId: "s1", turnId: "t1", chatTitle: "Phase 2A" },
    familiar: "sage",
  });
  assert.equal(res.ok, true);
  assert.equal(res.classify.rule, "paper-host");
  const rd = JSON.parse(await readFile(path.join(root, "reading.json"), "utf-8"));
  assert.equal(rd.length, 1);
  assert.equal(rd[0].sourceType, "paper");
  assert.equal(rd[0].capture.source.sessionId, "s1");
}

// 3. Default → bookmarks
{
  const res = await routeLinkHandler({
    url: "https://docs.python.org/3/",
    source: { kind: "browser", tabUrl: "https://docs.python.org/3/", tabTitle: "Python Docs" },
    familiar: "cody",
  });
  assert.equal(res.ok, true);
  assert.equal(res.classify.rule, "default-bookmark");
  const bm = JSON.parse(await readFile(path.join(root, "bookmarks.json"), "utf-8"));
  assert.equal(bm.length, 1);
  assert.equal(bm[0].domain, "docs.python.org");
}

// 4. Dedup — same URL + same source key returns deduped: true
{
  const first = await routeLinkHandler({
    url: "https://github.com/foo/bar/pull/9",
    source: { kind: "slash", originSessionId: null },
    familiar: "cody",
  });
  assert.equal(first.deduped, true);  // already routed in case 1 with same source
}

// 5. Ambiguous host without fallback → defaults to bookmarks
{
  const res = await routeLinkHandler({
    url: "https://twitter.com/foo/status/1",
    source: { kind: "slash", originSessionId: null },
    familiar: "cody",
  });
  assert.equal(res.ok, true);
  // familiar-classify is a Phase-7 task; for now the endpoint treats fallback as bookmarks
  assert.equal(res.item.url ?? res.item.notes ?? "", res.item.url ?? "");
  assert.equal(res.classify.rule, "familiar-fallback");
}

// 6. listHint override
{
  const res = await routeLinkHandler({
    url: "https://github.com/foo/baz",
    source: { kind: "slash", originSessionId: null },
    familiar: "cody",
    listHint: "bookmarks",
  });
  assert.equal(res.ok, true);
  assert.equal(res.classify.rule, "default-bookmark");
}

// 7. Invalid URL
{
  const res = await routeLinkHandler({
    url: "not-a-url",
    source: { kind: "manual" },
    familiar: "cody",
  });
  assert.equal(res.ok, false);
  assert.equal(res.error, "invalid_url");
}

await rm(root, { recursive: true, force: true });
console.log("route-link: 7 integration cases passed");
```

- [ ] **Step 8.2: Run it — expect FAIL**

```bash
node --test --experimental-strip-types src/app/api/library/route-link/route.test.ts 2>&1 | tail -10
```
Expected: FAIL `Cannot find module ./route.ts`.

- [ ] **Step 8.3: Make `library-store` honor `CAVE_LIBRARY_DIR`**

Edit `src/lib/library-store.ts` — change the `DEFAULT_ROOT` declaration:

```ts
const DEFAULT_ROOT = process.env.CAVE_LIBRARY_DIR
  ? process.env.CAVE_LIBRARY_DIR
  : path.join(homedir(), ".openclaw", "workspace", "sage", "library");
```

This lets tests target a tmp dir without changing call sites.

- [ ] **Step 8.4: Implement `route-link/route.ts`**

Create `src/app/api/library/route-link/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { createLibraryStore } from "@/lib/library-store";
import { classifyLink } from "@/lib/link-classifier";
import type {
  LinkCapture, LinkSource, LibraryBookmark, LibraryReadingItem,
  LibraryGitHubItem, LibrarySectionKind,
} from "@/lib/library-types";

type RouteList = "bookmarks" | "reading" | "github";

export type RouteLinkInput = {
  url: string;
  source: LinkSource;
  familiar: string;
  tags?: string[];
  listHint?: RouteList;
};

export type RouteLinkOk = {
  ok: true;
  deduped: boolean;
  item: LibraryBookmark | LibraryReadingItem | LibraryGitHubItem;
  classify: { rule: string; confidence: "high" | "low" };
};
export type RouteLinkErr = { ok: false; error: "invalid_url" | "write_failed" | "busy" };
export type RouteLinkResult = RouteLinkOk | RouteLinkErr;

function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function domainFrom(url: URL): string {
  return url.hostname.replace(/^www\./, "");
}

function titleFromReadingPath(url: URL): string {
  const segments = url.pathname.split("/").filter(Boolean);
  const last = segments[segments.length - 1] ?? "";
  if (!last) return domainFrom(url);
  return last
    .replace(/[-_]+/g, " ")
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim() || domainFrom(url);
}

export async function routeLinkHandler(body: RouteLinkInput): Promise<RouteLinkResult> {
  let parsed: URL;
  try { parsed = new URL(body.url); } catch { return { ok: false, error: "invalid_url" }; }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "invalid_url" };
  }

  const store = createLibraryStore();
  const sessionId = body.source.kind === "chat" ? body.source.sessionId
    : body.source.kind === "slash" ? body.source.originSessionId
    : null;
  const turnId = body.source.kind === "chat" ? body.source.turnId : null;

  // Dedup check.
  if (await store.hasIndexEntry(body.url, sessionId, turnId)) {
    // Return the previously-written item (best-effort lookup).
    const [bm, rd, gh] = await Promise.all([store.readBookmarks(), store.readReading(), store.readGithub()]);
    const all = [...bm, ...rd, ...gh] as any[];
    const item = all.find((i) => i.url === body.url);
    return {
      ok: true,
      deduped: true,
      item: item ?? ({} as any),
      classify: { rule: item?.capture?.classifier?.rule ?? "default-bookmark", confidence: "low" },
    };
  }

  // Classify (or honor explicit hint).
  let classify = body.listHint
    ? { rule: "default-bookmark" as const, confidence: "low" as const, list: body.listHint }
    : classifyLink(body.url);

  // Phase 7 will replace this branch with a familiar harness call.
  if (classify.rule === "familiar-fallback") {
    classify = { ...classify, list: "bookmarks" };
  }

  const list: RouteList = (classify.list ?? "bookmarks") as RouteList;
  const capture: LinkCapture = {
    source: body.source,
    familiar: body.familiar,
    capturedAt: new Date().toISOString(),
    classifier: { rule: classify.rule, confidence: classify.confidence },
  };

  let item: LibraryBookmark | LibraryReadingItem | LibraryGitHubItem;
  try {
    if (list === "github") {
      const gp = classifyLink(body.url).githubParse;
      const repo = gp?.repo ?? "";
      const number = gp?.number;
      const kind = gp?.kind ?? "repo";
      const title = number ? `${repo} #${number}` : repo || domainFrom(parsed);
      const ghItem: LibraryGitHubItem = {
        id: generateId("gh"),
        kind, repo, number, title, url: body.url,
        labels: [], savedAt: capture.capturedAt,
        familiar: body.familiar,
        capture,
      };
      await store.appendGithub(ghItem);
      item = ghItem;
    } else if (list === "reading") {
      const readingKind =
        classify.rule === "paper-host" ? "paper" :
        classify.rule === "video-host" ? "video" :
        classify.rule === "article-host" ? "article" : "article";
      const rdItem: LibraryReadingItem = {
        id: generateId("rd"),
        title: titleFromReadingPath(parsed),
        url: body.url,
        sourceType: readingKind,
        status: "want-to-read",
        tags: body.tags ?? [],
        addedAt: capture.capturedAt,
        familiar: body.familiar,
        capture,
      };
      await store.appendReading(rdItem);
      item = rdItem;
    } else {
      const bmItem: LibraryBookmark = {
        id: generateId("bm"),
        url: body.url,
        title: domainFrom(parsed),
        domain: domainFrom(parsed),
        tags: body.tags ?? [],
        savedAt: capture.capturedAt,
        familiar: body.familiar,
        capture,
      };
      await store.appendBookmark(bmItem);
      item = bmItem;
    }

    await store.appendIndexEntry({ url: body.url, sessionId, turnId, list, itemId: item.id });
  } catch {
    return { ok: false, error: "write_failed" };
  }

  return { ok: true, deduped: false, item, classify: { rule: classify.rule, confidence: classify.confidence } };
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as RouteLinkInput;
  const result = await routeLinkHandler(body);
  const status = result.ok ? 200 : result.error === "invalid_url" ? 400 : 500;
  return NextResponse.json(result, { status });
}
```

- [ ] **Step 8.5: Run the integration test**

```bash
node --test --experimental-strip-types src/app/api/library/route-link/route.test.ts 2>&1 | tail -10
```
Expected: PASS — "route-link: 7 integration cases passed".

- [ ] **Step 8.6: Typecheck**

```bash
pnpm typecheck
```
Expected: clean.

- [ ] **Step 8.7: Commit**

```bash
git add src/lib/library-store.ts src/app/api/library/route-link/route.ts src/app/api/library/route-link/route.test.ts
git commit -S -m "feat(library): POST /api/library/route-link

Single ingestion endpoint. Idempotent by (url, sessionId, turnId)
via .index.json. Honors listHint override. Familiar-fallback Tier
currently defaults to bookmarks; Phase 7 wires the real fallback.
7 integration cases against a tmp library dir."
```

---

## Phase 4 — `library/all` endpoint + Timeline UI

### Task 9: `GET /api/library/all`

**Files:**
- Create: `src/app/api/library/all/route.ts`

- [ ] **Step 9.1: Write the route**

Create `src/app/api/library/all/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { createLibraryStore } from "@/lib/library-store";
import type {
  LibraryBookmark, LibraryReadingItem, LibraryGitHubItem, LinkSource,
} from "@/lib/library-types";

export type TimelineEntry = {
  list: "bookmarks" | "reading" | "github";
  item: LibraryBookmark | LibraryReadingItem | LibraryGitHubItem;
  capturedAt: string;
  familiar: string | null;
  source: LinkSource | null;
};

function timestampOf(
  list: "bookmarks" | "reading" | "github",
  item: LibraryBookmark | LibraryReadingItem | LibraryGitHubItem,
): string {
  if (item.capture?.capturedAt) return item.capture.capturedAt;
  if (list === "reading") return (item as LibraryReadingItem).addedAt;
  return (item as LibraryBookmark | LibraryGitHubItem).savedAt;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const familiarFilter = url.searchParams.get("familiar");
  const listFilter = url.searchParams.get("list") as TimelineEntry["list"] | null;
  const since = url.searchParams.get("since");

  const store = createLibraryStore();
  const [bookmarks, reading, github] = await Promise.all([
    store.readBookmarks(), store.readReading(), store.readGithub(),
  ]);

  const all: TimelineEntry[] = [
    ...bookmarks.map((item) => ({ list: "bookmarks" as const, item,
      capturedAt: timestampOf("bookmarks", item),
      familiar: item.capture?.familiar ?? item.familiar ?? null,
      source: item.capture?.source ?? null })),
    ...reading.map((item) => ({ list: "reading" as const, item,
      capturedAt: timestampOf("reading", item),
      familiar: item.capture?.familiar ?? item.familiar ?? null,
      source: item.capture?.source ?? null })),
    ...github.map((item) => ({ list: "github" as const, item,
      capturedAt: timestampOf("github", item),
      familiar: item.capture?.familiar ?? item.familiar ?? null,
      source: item.capture?.source ?? null })),
  ];

  const filtered = all
    .filter((e) => !familiarFilter || familiarFilter === "all" || e.familiar === familiarFilter)
    .filter((e) => !listFilter || listFilter === ("all" as any) || e.list === listFilter)
    .filter((e) => !since || e.capturedAt >= since)
    .sort((a, b) => (a.capturedAt < b.capturedAt ? 1 : -1));

  return NextResponse.json({ ok: true, entries: filtered });
}
```

- [ ] **Step 9.2: Typecheck**

```bash
pnpm typecheck
```
Expected: clean.

- [ ] **Step 9.3: Manual smoke (with stubbed data)**

This endpoint can be smoke-tested directly via the dev server once the UI is wired. No standalone test for now — the timeline component test (Task 11) asserts the route is called.

- [ ] **Step 9.4: Commit**

```bash
git add src/app/api/library/all/route.ts
git commit -S -m "feat(library): GET /api/library/all timeline endpoint

Unified read across bookmarks/reading/github with optional
familiar / list / since query filters. Normalizes capturedAt
from capture.capturedAt or per-type timestamp."
```

### Task 10: `library-timeline-row.tsx` (the row template)

**Files:**
- Create: `src/components/library-timeline-row.tsx`

- [ ] **Step 10.1: Write the component**

Create `src/components/library-timeline-row.tsx`:

```tsx
"use client";

import { Icon, type IconName } from "@/lib/icon";
import type { TimelineEntry } from "@/app/api/library/all/route";
import type { Familiar } from "@/lib/types";

function listIcon(list: TimelineEntry["list"]): IconName {
  if (list === "github") return "ph:github-logo";
  if (list === "reading") return "ph:book-open";
  return "ph:bookmark-simple";
}

function ruleLabel(entry: TimelineEntry, familiars: Familiar[]): string {
  const rule = entry.item.capture?.classifier?.rule;
  if (!rule) return "manual";
  if (rule === "familiar-fallback") {
    const fam = familiars.find((f) => f.id === entry.familiar);
    return `${fam?.display_name ?? "Familiar"} guessed`;
  }
  return rule;
}

function sourcePillText(entry: TimelineEntry): string | null {
  const s = entry.source;
  if (!s) return null;
  if (s.kind === "chat") return `chat “${s.chatTitle}”`;
  if (s.kind === "browser") return "Save button";
  if (s.kind === "slash") return s.originSessionId ? "/save in chat" : "/save";
  if (s.kind === "feed") return `RSS · ${s.feedTitle}`;
  return null;
}

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diff) || diff < 0) return "now";
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return `${Math.floor(d / 7)}w`;
}

export function LibraryTimelineRow({
  entry,
  familiars,
  selected,
  onSelect,
}: {
  entry: TimelineEntry;
  familiars: Familiar[];
  selected: boolean;
  onSelect: () => void;
}) {
  const fam = familiars.find((f) => f.id === entry.familiar);
  const pill = sourcePillText(entry);
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`focus-ring-inset grid w-full grid-cols-[24px_1fr_auto_auto] items-center gap-3 border-l-2 px-3 py-2 text-left text-[12px] transition-colors ${
        selected
          ? "border-l-[var(--accent-presence)] bg-[var(--bg-hover)]"
          : "border-l-transparent hover:bg-[var(--bg-hover)]"
      }`}
      aria-current={selected ? "true" : undefined}
    >
      <span className="flex h-5 w-5 items-center justify-center rounded text-[var(--text-primary)]">
        <Icon name={listIcon(entry.list)} width={14} aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[var(--text-primary)]">
          {entry.item.title || entry.item.url}
        </span>
        <span className="mt-0.5 flex items-center gap-1.5 text-[10px] text-[var(--text-muted)]">
          {fam ? <span>{fam.display_name}</span> : null}
          {pill ? (
            <>
              {fam ? <span aria-hidden>·</span> : null}
              <span className="rounded bg-[var(--bg-raised)] px-1.5 py-0.5 text-[var(--accent-presence)]">
                {pill}
              </span>
            </>
          ) : null}
        </span>
      </span>
      <span className="rounded border border-[var(--border-hairline)] px-1.5 py-0.5 text-[9px] text-[var(--text-muted)]">
        {ruleLabel(entry, familiars)}
      </span>
      <span className="text-[10px] tabular-nums text-[var(--text-muted)]">
        {relTime(entry.capturedAt)}
      </span>
    </button>
  );
}
```

- [ ] **Step 10.2: Typecheck**

```bash
pnpm typecheck
```
Expected: clean.

- [ ] **Step 10.3: Commit**

```bash
git add src/components/library-timeline-row.tsx
git commit -S -m "feat(library): LibraryTimelineRow component

[list-icon] [title + familiar + source-pill] [classifier-badge]
[relative-time] grid. Consumes the new TimelineEntry shape."
```

### Task 11: `library-timeline.tsx` (the All view)

**Files:**
- Create: `src/components/library-timeline.tsx`
- Create: `src/components/library-timeline.test.ts`

- [ ] **Step 11.1: Write the wiring test**

Create `src/components/library-timeline.test.ts`:

```ts
// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./library-timeline.tsx", import.meta.url), "utf8");

assert.match(source, /from "@\/components\/ui\/view-header"/, "uses ViewHeader primitive");
assert.match(source, /from "@\/components\/ui\/search-input"/, "uses SearchInput primitive");
assert.match(source, /from "@\/components\/ui\/empty-state"/, "uses EmptyState primitive");
assert.match(source, /from "@\/components\/ui\/skeleton"/, "uses Skeleton primitive");
assert.match(source, /from "@\/components\/library-timeline-row"/, "renders LibraryTimelineRow");
assert.match(source, /fetch\(`?\/api\/library\/all/, "calls /api/library/all");
assert.match(source, /groupBy.*"date".*"source"/s, "supports group-by date|source");
assert.match(source, /familiarFilter/, "supports familiar filter state");

console.log("library-timeline wiring: 8 assertions passed");
```

- [ ] **Step 11.2: Run it — expect FAIL**

```bash
node --test --experimental-strip-types src/components/library-timeline.test.ts 2>&1 | tail -5
```
Expected: FAIL `ENOENT: no such file or directory, open '...library-timeline.tsx'`.

- [ ] **Step 11.3: Write `library-timeline.tsx`**

Create `src/components/library-timeline.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ViewHeader } from "@/components/ui/view-header";
import { SearchInput } from "@/components/ui/search-input";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonRows } from "@/components/ui/skeleton";
import { LibraryTimelineRow } from "@/components/library-timeline-row";
import type { TimelineEntry } from "@/app/api/library/all/route";
import type { Familiar } from "@/lib/types";

type GroupBy = "date" | "source";
type ListFilter = "all" | "bookmarks" | "reading" | "github";

export function LibraryTimeline({
  familiars,
  selectedEntryId,
  onSelect,
}: {
  familiars: Familiar[];
  selectedEntryId: string | null;
  onSelect: (entry: TimelineEntry) => void;
}) {
  const [entries, setEntries] = useState<TimelineEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [groupBy, setGroupBy] = useState<GroupBy>("date");
  const [familiarFilter, setFamiliarFilter] = useState<string>("all");
  const [listFilter, setListFilter] = useState<ListFilter>("all");
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (familiarFilter !== "all") qs.set("familiar", familiarFilter);
      if (listFilter !== "all") qs.set("list", listFilter);
      const res = await fetch(`/api/library/all${qs.toString() ? "?" + qs.toString() : ""}`, { cache: "no-store" });
      const json = await res.json() as { ok: boolean; entries?: TimelineEntry[] };
      if (json.ok) setEntries(json.entries ?? []);
    } catch { setEntries([]); }
    finally { setLoading(false); }
  }, [familiarFilter, listFilter]);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) => {
      const hay = [e.item.title, (e.item as any).url ?? "", e.familiar ?? "",
        e.source?.kind === "chat" ? e.source.chatTitle : ""].join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [entries, search]);

  const groups = useMemo(() => {
    if (groupBy === "source") {
      const map = new Map<string, TimelineEntry[]>();
      for (const e of filtered) {
        const key = e.source?.kind === "chat"
          ? `chat “${e.source.chatTitle}”${e.familiar ? ` · ${e.familiar}` : ""}`
          : e.source?.kind === "browser" ? "Save button"
          : e.source?.kind === "slash" ? "/save"
          : e.source?.kind === "feed" ? `RSS · ${e.source.feedTitle}`
          : "Manual";
        (map.get(key) ?? map.set(key, []).get(key)!).push(e);
      }
      return Array.from(map.entries()).map(([label, items]) => ({ label, items }));
    }
    // group by date label
    const dayLabel = (iso: string) => {
      const d = new Date(iso);
      const today = new Date();
      const diff = Math.floor((today.getTime() - d.getTime()) / 86_400_000);
      if (diff < 1) return "Today";
      if (diff < 2) return "Yesterday";
      if (diff < 7) return "This week";
      if (diff < 30) return "This month";
      return "Older";
    };
    const map = new Map<string, TimelineEntry[]>();
    for (const e of filtered) {
      const k = dayLabel(e.capturedAt);
      (map.get(k) ?? map.set(k, []).get(k)!).push(e);
    }
    return Array.from(map.entries()).map(([label, items]) => ({ label, items }));
  }, [filtered, groupBy]);

  return (
    <div className="flex h-full flex-col">
      <ViewHeader
        eyebrow="LIBRARY"
        title="All"
        search={
          <SearchInput
            value={search}
            onValueChange={setSearch}
            placeholder="Search links — try chat: github: sage:"
            onClear={() => setSearch("")}
          />
        }
        filters={
          <>
            <select
              className="focus-ring rounded border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-2 py-1 text-[11px] text-[var(--text-primary)]"
              value={familiarFilter}
              onChange={(e) => setFamiliarFilter(e.target.value)}
              aria-label="Filter by familiar"
            >
              <option value="all">Familiar: all</option>
              {familiars.map((f) => (
                <option key={f.id} value={f.id}>{f.display_name}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setGroupBy((g) => g === "date" ? "source" : "date")}
              className="focus-ring rounded border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-2 py-1 text-[11px] text-[var(--text-primary)]"
            >
              Group: {groupBy}
            </button>
            <select
              className="focus-ring rounded border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-2 py-1 text-[11px] text-[var(--text-primary)]"
              value={listFilter}
              onChange={(e) => setListFilter(e.target.value as ListFilter)}
              aria-label="Filter by list"
            >
              <option value="all">All lists</option>
              <option value="bookmarks">Bookmarks</option>
              <option value="reading">Reading</option>
              <option value="github">GitHub</option>
            </select>
          </>
        }
      />
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-3"><SkeletonRows count={6} /></div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon="ph:link"
            headline="No links yet"
            subtitle="Drop a URL in any chat, hit Save in the browser, or run /save in the composer."
          />
        ) : (
          groups.map((g) => (
            <div key={g.label}>
              <div className="border-b border-[var(--border-hairline)] bg-[var(--bg-panel)] px-3 py-1.5 text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                {g.label} <span className="ml-2 normal-case text-[var(--text-muted)]">{g.items.length} link{g.items.length === 1 ? "" : "s"}</span>
              </div>
              {g.items.map((e) => (
                <LibraryTimelineRow
                  key={e.item.id}
                  entry={e}
                  familiars={familiars}
                  selected={e.item.id === selectedEntryId}
                  onSelect={() => onSelect(e)}
                />
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 11.4: Run the wiring test**

```bash
node --test --experimental-strip-types src/components/library-timeline.test.ts 2>&1 | tail -5
```
Expected: PASS — "library-timeline wiring: 8 assertions passed".

- [ ] **Step 11.5: Typecheck**

```bash
pnpm typecheck
```
Expected: clean. Note: `ph:link` and `ph:book-open` and `ph:bookmark-simple` and `ph:github-logo` must all be in `src/lib/icon.tsx` ICON_NAMES. Verify with `grep -E '"ph:(link|book-open|bookmark-simple|github-logo)"' src/lib/icon.tsx`. Add any missing ones to the allowlist and re-run typecheck.

- [ ] **Step 11.6: Commit**

```bash
git add src/components/library-timeline.tsx src/components/library-timeline.test.ts
git commit -S -m "feat(library): LibraryTimeline (the All view)

Toolbar (ViewHeader + SearchInput + familiar/list/group filters),
grouped by date or source, EmptyState + SkeletonRows. 8-assertion
wiring test."
```

### Task 12: Wire timeline into `library-view.tsx` and make "all" the default

**Files:**
- Modify: `src/lib/library-types.ts`
- Modify: `src/components/library-view.tsx`
- Modify: `src/components/library-collection-rail.tsx`

- [ ] **Step 12.1: Add `"all"` to `LibrarySectionKind`**

Edit `src/lib/library-types.ts` — update the union:

```ts
export type LibrarySectionKind = "all" | "docs" | "bookmarks" | "reading" | "github" | "skills";
```

- [ ] **Step 12.2: Edit `library-view.tsx`**

In `src/components/library-view.tsx`:

Change the initial state on line ~23 from:
```ts
const [activeSection, setActiveSection] = useState<LibrarySectionKind>("docs");
```
to:
```ts
const [activeSection, setActiveSection] = useState<LibrarySectionKind>("all");
```

Add the import at the top:
```ts
import { LibraryTimeline } from "@/components/library-timeline";
import type { TimelineEntry } from "@/app/api/library/all/route";
```

Add state for timeline familiars + selection. After the existing `useState<LibrarySectionKind>` line, add:
```ts
const [familiars, setFamiliars] = useState<Familiar[]>([]);
const [timelineSelectedId, setTimelineSelectedId] = useState<string | null>(null);

useEffect(() => {
  void fetch("/api/familiars", { cache: "no-store" })
    .then((r) => r.json())
    .then((j) => { if (j.ok) setFamiliars(j.familiars ?? []); })
    .catch(() => undefined);
}, []);
```

Add the import `import type { Familiar } from "@/lib/types";` if not already present.

In the conditional render block (lines ~135-165 currently), add a new branch BEFORE the `docs` one:
```tsx
{activeSection === "all" && (
  <LibraryTimeline
    familiars={familiars}
    selectedEntryId={timelineSelectedId}
    onSelect={(entry) => {
      setTimelineSelectedId(entry.item.id);
      if (entry.list === "bookmark" || (entry as any).list === "bookmarks") {
        setSelectedItem({ kind: "bookmark", item: entry.item as any });
      } else if (entry.list === "reading") {
        setSelectedItem({ kind: "reading", item: entry.item as any });
      } else {
        setSelectedItem({ kind: "github", item: entry.item as any });
      }
    }}
  />
)}
```

- [ ] **Step 12.3: Edit `library-collection-rail.tsx`**

Open `src/components/library-collection-rail.tsx`. Find the section list (it's an array of section objects rendered as buttons). Add an `"all"` entry at the top of that list:

```ts
const SECTIONS: Array<{ id: LibrarySectionKind; label: string; icon: IconName }> = [
  { id: "all", label: "All", icon: "ph:link" },
  { id: "docs", label: "Docs", icon: "ph:file-text" },
  { id: "bookmarks", label: "Bookmarks", icon: "ph:bookmark-simple" },
  { id: "reading", label: "Reading", icon: "ph:book-open" },
  { id: "github", label: "GitHub", icon: "ph:github-logo" },
  { id: "skills", label: "Skills", icon: "ph:sparkle" },
];
```

(Use the existing section-shape from this file; only add the "all" entry and reorder as shown.)

- [ ] **Step 12.4: Typecheck**

```bash
pnpm typecheck
```
Expected: clean.

- [ ] **Step 12.5: Manual smoke**

```bash
pkill -f 'next dev' 2>/dev/null; sleep 1
pnpm dev > /tmp/cave-dev.log 2>&1 &
sleep 5
curl -s http://localhost:3000/api/library/all | head -200
```
Expected: JSON with `{ ok: true, entries: [...] }`. Open `http://localhost:3000`, navigate to Library — "All" should be the default section, showing the timeline (likely empty unless there's existing data).

```bash
pkill -f 'next dev'
```

- [ ] **Step 12.6: Commit**

```bash
git add src/lib/library-types.ts src/components/library-view.tsx src/components/library-collection-rail.tsx
git commit -S -m "feat(library): mount LibraryTimeline as default Library section

LibrarySectionKind gains 'all'; activeSection initial state moves
from 'docs' to 'all'. Collection rail shows All first."
```

---

## Phase 5 — Adapters

### Task 13: Chat-scan inside `/api/chat/send`

**Files:**
- Modify: `src/app/api/chat/send/route.ts`
- Create: `src/components/chat-send-routes-links.test.ts`

- [ ] **Step 13.1: Write the wiring test**

Create `src/components/chat-send-routes-links.test.ts`:

```ts
// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../app/api/chat/send/route.ts", import.meta.url), "utf8");

assert.match(source, /import \{ extractLinks \} from "@\/lib\/link-extractor"/,
  "chat/send imports extractLinks");
assert.match(source, /import \{ routeLinkHandler \} from "@\/app\/api\/library\/route-link\/route"/,
  "chat/send imports routeLinkHandler");
assert.match(source, /extractLinks\(\s*prompt\s*\)/,
  "chat/send extracts links from the prompt");
assert.match(source, /try\s*\{[\s\S]*?routeLinkHandler/,
  "routeLinkHandler call wrapped in try/catch");
assert.match(source, /kind: "chat"/,
  "uses chat source kind");

console.log("chat-send-routes-links: 5 assertions passed");
```

- [ ] **Step 13.2: Run it — expect FAIL**

```bash
node --test --experimental-strip-types src/components/chat-send-routes-links.test.ts 2>&1 | tail -5
```
Expected: FAIL.

- [ ] **Step 13.3: Inspect the existing send route**

```bash
sed -n '1,60p' src/app/api/chat/send/route.ts
```
Identify where the request body is parsed (`familiarId`, `prompt`, `sessionId`/`chatTitle` if present). Note line numbers.

- [ ] **Step 13.4: Modify `/api/chat/send/route.ts`**

At the top, add imports:
```ts
import { extractLinks } from "@/lib/link-extractor";
import { routeLinkHandler } from "@/app/api/library/route-link/route";
```

After the body parse (where `familiarId`, `prompt` are available), add a fire-and-forget helper before the daemon call:

```ts
function scheduleLinkRoute(args: {
  text: string;
  sessionId: string | null;
  turnId: string | null;
  chatTitle: string;
  familiar: string;
}) {
  if (!args.sessionId || !args.turnId) return; // chat-source requires both
  const urls = extractLinks(args.text);
  for (const url of urls) {
    void (async () => {
      try {
        await routeLinkHandler({
          url,
          source: {
            kind: "chat",
            sessionId: args.sessionId!,
            turnId: args.turnId!,
            chatTitle: args.chatTitle,
          },
          familiar: args.familiar,
        });
      } catch (err) {
        console.warn("[chat-send] routeLink failed:", (err as Error).message);
      }
    })();
  }
}
```

Then, **before** initiating the streaming response, call `scheduleLinkRoute` for the user prompt:
```ts
scheduleLinkRoute({
  text: prompt,
  sessionId: sessionId ?? null,
  turnId: userTurnId ?? null,
  chatTitle: chatTitle ?? "",
  familiar: familiarId,
});
```

(If the existing send-route does not currently know `sessionId` / `userTurnId` until the daemon responds, hook into the SSE event handler where the `session` event arrives and call `scheduleLinkRoute` with the prompt text at that point.)

At **stream-complete** (the existing handler where the final assistant text is known and `assistantTurnId` is available — typically in the SSE `final` or `complete` event), call:
```ts
scheduleLinkRoute({
  text: assistantText,
  sessionId,
  turnId: assistantTurnId,
  chatTitle,
  familiar: familiarId,
});
```

The existing streaming flow remains unchanged; only these two fire-and-forget calls are added. Both are wrapped in `try/catch`; failures are logged and swallowed.

- [ ] **Step 13.5: Run the wiring test**

```bash
node --test --experimental-strip-types src/components/chat-send-routes-links.test.ts 2>&1 | tail -5
```
Expected: PASS.

- [ ] **Step 13.6: Typecheck**

```bash
pnpm typecheck
```
Expected: clean.

- [ ] **Step 13.7: Commit**

```bash
git add src/app/api/chat/send/route.ts src/components/chat-send-routes-links.test.ts
git commit -S -m "feat(library): chat-scan adapter in /api/chat/send

Fire-and-forget routeLinkHandler call for URLs in user prompt
(at request) and assistant text (at stream complete). Wrapped in
try/catch so route-link failures never affect the chat stream."
```

### Task 14: Browser-pane Save button

**Files:**
- Modify: `src/components/browser-pane.tsx`
- Create: `src/components/browser-pane-save.test.ts`

- [ ] **Step 14.1: Write the wiring test**

Create `src/components/browser-pane-save.test.ts`:

```ts
// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./browser-pane.tsx", import.meta.url), "utf8");

assert.match(source, /from "@\/components\/ui\/icon-button"/,
  "browser-pane imports IconButton");
assert.match(source, /icon="ph:bookmark-simple"/,
  "renders a bookmark-simple IconButton");
assert.match(source, /aria-label="Save to library"/,
  "Save button has aria-label");
assert.match(source, /\/api\/library\/route-link/,
  "POSTs to route-link endpoint");
assert.match(source, /kind: "browser"/,
  "uses browser source kind");

console.log("browser-pane-save: 5 assertions passed");
```

- [ ] **Step 14.2: Run it — expect FAIL**

```bash
node --test --experimental-strip-types src/components/browser-pane-save.test.ts 2>&1 | tail -5
```
Expected: FAIL.

- [ ] **Step 14.3: Inspect browser-pane.tsx toolbar**

```bash
grep -nE 'address-bar|toolbar|daemon-status|tab-rail|<header|<div className="browser' src/components/browser-pane.tsx | head -20
```
Locate the toolbar area (likely a div containing the address bar + back/forward + reload buttons).

- [ ] **Step 14.4: Add the Save button**

At the top of `src/components/browser-pane.tsx` add:
```ts
import { IconButton } from "@/components/ui/icon-button";
```

In the toolbar render block (just left of the daemon-status pill or to the right of the address bar — match the existing flex layout), add:

```tsx
<SaveToLibraryButton
  url={currentTab?.url ?? null}
  title={currentTab?.title ?? ""}
  activeFamiliar={props.activeFamiliarId}
/>
```

At the bottom of the file (above the default export) add the helper component:

```tsx
function SaveToLibraryButton({
  url, title, activeFamiliar,
}: { url: string | null; title: string; activeFamiliar: string | null }) {
  const [state, setState] = useState<"idle" | "saving" | "saved" | "dedup" | "err">("idle");
  if (!url) return null;
  return (
    <IconButton
      icon={state === "saved" ? "ph:check-bold" : state === "dedup" ? "ph:bookmark-simple-fill" : "ph:bookmark-simple"}
      aria-label="Save to library"
      title={state === "saved" ? "Saved" : state === "dedup" ? "Already in library" : "Save to library"}
      onClick={async () => {
        if (!activeFamiliar) return;
        setState("saving");
        try {
          const res = await fetch("/api/library/route-link", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              url,
              source: { kind: "browser", tabUrl: url, tabTitle: title },
              familiar: activeFamiliar,
            }),
          });
          const json = await res.json() as { ok: boolean; deduped?: boolean };
          if (!json.ok) setState("err");
          else if (json.deduped) setState("dedup");
          else setState("saved");
        } catch { setState("err"); }
        finally { setTimeout(() => setState("idle"), 3000); }
      }}
    />
  );
}
```

Add `useState` to the existing react import at the top of the file if it isn't already there.

The component requires `activeFamiliarId` to be passed in via props to `BrowserPane`. If `browser-pane.tsx` doesn't already accept that prop, add it to the `Props` type and have its callers pass it. (Check `workspace.tsx` for the BrowserPane mount and ensure `activeFamiliar?.id ?? null` is passed.)

- [ ] **Step 14.5: Add `ph:bookmark-simple-fill` to icon allowlist if missing**

```bash
grep -E '"ph:bookmark-simple(-fill)?"' src/lib/icon.tsx
```
If `ph:bookmark-simple-fill` is not present, append it to the `ICON_NAMES` array (alphabetical position around the bookmark entries).

- [ ] **Step 14.6: Run the wiring test**

```bash
node --test --experimental-strip-types src/components/browser-pane-save.test.ts 2>&1 | tail -5
```
Expected: PASS.

- [ ] **Step 14.7: Typecheck**

```bash
pnpm typecheck
```
Expected: clean.

- [ ] **Step 14.8: Commit**

```bash
git add src/components/browser-pane.tsx src/components/browser-pane-save.test.ts src/lib/icon.tsx
git commit -S -m "feat(library): browser-pane Save IconButton

Adds Save to library button to the browser toolbar. POSTs to
/api/library/route-link with source.kind = 'browser'. Icon swaps
to check / fill on save / dedup; reverts after 3s."
```

### Task 15: `/save` slash command

**Files:**
- Modify: `src/lib/slash-commands.ts`
- Modify: `src/components/chat-view.tsx` (or wherever the slash dispatcher lives)

- [ ] **Step 15.1: Add the slash entry**

In `src/lib/slash-commands.ts`, find the existing `SLASH_COMMANDS` array. Add:

```ts
{
  name: "/save",
  aliases: ["/bookmark", "/read"],
  hint: "/save <url> [bookmarks|reading|github] [#tag]",
  description: "Route a URL into the library (auto-classified)",
},
```

(Match the existing shape — copy field names from an adjacent entry.)

- [ ] **Step 15.2: Locate the slash dispatcher**

```bash
grep -nE 'SLASH_COMMANDS\[|slashHandler|dispatchSlash|handleSlash|onSlashCommand' src/components/chat-view.tsx src/components/home-composer.tsx 2>&1 | head -10
```
Identify where slash commands are dispatched (where the user's `/foo` typed input is consumed and routed). Likely in `chat-view.tsx` near the composer submit handler.

- [ ] **Step 15.3: Wire `/save` to call routeLink**

In the slash dispatcher (file identified in 15.2), add:

```ts
import { slashSaveParse } from "@/lib/slash-save-parser";
```

Inside the dispatcher switch / map, add a branch for `"/save" | "/bookmark" | "/read"`:

```ts
if (cmd === "/save" || cmd === "/bookmark" || cmd === "/read") {
  const parsed = slashSaveParse(args);
  if ("error" in parsed) {
    onToast?.("Usage: /save <url> [bookmarks|reading|github] [#tag]");
    return;
  }
  try {
    const res = await fetch("/api/library/route-link", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: parsed.url,
        source: { kind: "slash", originSessionId: sessionId ?? null },
        familiar: activeFamiliarId,
        tags: parsed.tags,
        listHint: parsed.listHint,
      }),
    });
    const json = await res.json() as { ok: boolean; deduped?: boolean; classify?: { rule: string } };
    if (!json.ok) onToast?.("Save failed.");
    else if (json.deduped) onToast?.(`Already in library.`);
    else onToast?.(`Saved to ${json.classify?.rule === "github" ? "GitHub" : json.classify?.rule?.includes("article") || json.classify?.rule?.includes("paper") || json.classify?.rule?.includes("video") ? "Reading" : "Bookmarks"}.`);
  } catch { onToast?.("Save failed."); }
  return;
}
```

Adjust variable names to match the dispatcher's local scope (likely `sessionId`, `activeFamiliarId`, `onToast`).

- [ ] **Step 15.4: Typecheck**

```bash
pnpm typecheck
```
Expected: clean.

- [ ] **Step 15.5: Manual smoke**

```bash
pkill -f 'next dev' 2>/dev/null; sleep 1
pnpm dev > /tmp/cave-dev.log 2>&1 &
sleep 5
```
Open `http://localhost:3000`, type `/save https://github.com/foo/bar` in a chat composer, submit. Verify the toast appears and `~/.openclaw/workspace/sage/library/github.json` gains a new entry.

```bash
pkill -f 'next dev'
```

- [ ] **Step 15.6: Commit**

```bash
git add src/lib/slash-commands.ts src/components/chat-view.tsx
git commit -S -m "feat(library): /save slash command

/save <url> [bookmarks|reading|github] [#tag]. Aliases:
/bookmark, /read. Calls /api/library/route-link with
source.kind = 'slash'. Toasts the destination list on success."
```

---

## Phase 6 — Cleanup (drop hardcoded "sage")

### Task 16: Remove `"sage"` fallback in routes once adapters are live

**Files:**
- Modify: `src/app/api/library/bookmarks/route.ts`
- Modify: `src/app/api/library/reading/route.ts`
- Modify: `src/app/api/library/github/route.ts`

- [ ] **Step 16.1: Update bookmarks route**

In `src/app/api/library/bookmarks/route.ts`, find the `familiar:` assignment in `POST`:

```ts
familiar: body.capture?.familiar ?? body.familiar ?? "sage",
```

Change to:

```ts
familiar: body.capture?.familiar ?? body.familiar ?? "unknown",
```

(`"unknown"` is the new explicit fallback for direct POSTs without a familiar; the routes-link endpoint always supplies one.)

Do the same in `reading/route.ts` and `github/route.ts`.

- [ ] **Step 16.2: Verify no remaining hardcoded "sage" in routes**

```bash
rg '"sage"' src/app/api/library/
```
Expected: only the storage path (`~/.openclaw/workspace/sage/library/`) remains; no `familiar: "sage"`.

- [ ] **Step 16.3: Typecheck + tests**

```bash
pnpm typecheck
node --test --experimental-strip-types src/app/api/library/route-link/route.test.ts 2>&1 | tail -5
```
Expected: both pass.

- [ ] **Step 16.4: Commit**

```bash
git add src/app/api/library/bookmarks/route.ts src/app/api/library/reading/route.ts src/app/api/library/github/route.ts
git commit -S -m "chore(library): drop 'sage' familiar fallback in routes

Direct POSTs to the per-list routes now fall back to 'unknown'
when no familiar is supplied. /api/library/route-link always
supplies the real active familiar, so this only affects callers
that bypass the new ingestion pipeline."
```

---

## Phase 7 — Familiar fallback (optional; ship after the rest)

### Task 17: `familiar-classify.ts` + mocked tests

**Files:**
- Create: `src/lib/familiar-classify.ts`
- Create: `src/lib/familiar-classify.test.ts`

- [ ] **Step 17.1: Write the failing test**

Create `src/lib/familiar-classify.test.ts`:

```ts
// @ts-nocheck
import assert from "node:assert/strict";
import { classifyWithFamiliar } from "./familiar-classify.ts";

// Happy paths
{
  const res = await classifyWithFamiliar(
    "https://twitter.com/foo/status/1",
    { sourceText: "Worth reading: ..." },
    { id: "cody", display_name: "Cody" } as any,
    { ask: async () => "b" } as any,
  );
  assert.equal(res.list, "reading");
  assert.equal(res.rule, "familiar-fallback");
  assert.equal(res.confidence, "low");
}

{
  const res = await classifyWithFamiliar(
    "https://x.com/foo/profile",
    {},
    { id: "cody", display_name: "Cody" } as any,
    { ask: async () => "a" } as any,
  );
  assert.equal(res.list, "bookmarks");
}

// Garbage reply → bookmark
{
  const res = await classifyWithFamiliar(
    "https://reddit.com/x",
    {},
    { id: "cody", display_name: "Cody" } as any,
    { ask: async () => "I think it's a paper" } as any,
  );
  assert.equal(res.list, "bookmarks");
}

// Timeout → bookmark
{
  const res = await classifyWithFamiliar(
    "https://reddit.com/x",
    {},
    { id: "cody", display_name: "Cody" } as any,
    { ask: () => new Promise((resolve) => setTimeout(() => resolve("b"), 4000)) } as any,
  );
  assert.equal(res.list, "bookmarks");  // 3s budget elapsed
}

// 'c' for non-github URL → bookmark
{
  const res = await classifyWithFamiliar(
    "https://reddit.com/x",
    {},
    { id: "cody", display_name: "Cody" } as any,
    { ask: async () => "c" } as any,
  );
  assert.equal(res.list, "bookmarks");
}

console.log("familiar-classify: 5 cases passed");
```

- [ ] **Step 17.2: Run it — expect FAIL**

```bash
node --test --experimental-strip-types src/lib/familiar-classify.test.ts 2>&1 | tail -5
```
Expected: FAIL.

- [ ] **Step 17.3: Implement `familiar-classify.ts`**

Create `src/lib/familiar-classify.ts`:

```ts
import type { ClassifyResult } from "./link-classifier";
import { parseGitHubUrl } from "./link-classifier";
import type { Familiar } from "./types";

export type HarnessAsker = { ask: (prompt: string) => Promise<string> };

const TIMEOUT_MS = 3000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    p.then((v) => v),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]) as Promise<T | null>;
}

function buildPrompt(url: string, ctx: { sourceText?: string; pageTitle?: string }): string {
  const context = ctx.sourceText?.slice(0, 200) ?? ctx.pageTitle ?? "(no context)";
  return `Given URL ${url} and the surrounding context ${JSON.stringify(context)}, classify as one of:
(a) bookmark — a tool, landing page, or reference site
(b) reading — an article, paper, thread, or video meant to be consumed
(c) github — a github.com URL
Reply with one letter only.`;
}

function fallbackBookmark(): ClassifyResult {
  return { list: "bookmarks", rule: "familiar-fallback", confidence: "low" };
}

export async function classifyWithFamiliar(
  url: string,
  ctx: { sourceText?: string; pageTitle?: string },
  _familiar: Familiar,
  asker: HarnessAsker,
): Promise<ClassifyResult> {
  let raw: string | null;
  try { raw = await withTimeout(asker.ask(buildPrompt(url, ctx)), TIMEOUT_MS); }
  catch { return fallbackBookmark(); }
  if (!raw) return fallbackBookmark();

  const letter = raw.trim().slice(0, 1).toLowerCase();
  if (letter === "a") return { list: "bookmarks", rule: "familiar-fallback", confidence: "low" };
  if (letter === "b") return { list: "reading", readingKind: "article", rule: "familiar-fallback", confidence: "low" };
  if (letter === "c") {
    if (parseGitHubUrl(url)) return { list: "github", rule: "familiar-fallback", confidence: "low" };
    return fallbackBookmark();
  }
  return fallbackBookmark();
}
```

- [ ] **Step 17.4: Run the test**

```bash
node --test --experimental-strip-types src/lib/familiar-classify.test.ts 2>&1 | tail -5
```
Expected: PASS.

- [ ] **Step 17.5: Commit**

```bash
git add src/lib/familiar-classify.ts src/lib/familiar-classify.test.ts
git commit -S -m "feat(library): familiar-classify Tier-5 fallback

Async ask-the-familiar helper. 3s timeout, garbage reply falls
back to bookmark, 'c' for non-github URL falls back to bookmark.
HarnessAsker interface is injectable so tests can mock."
```

### Task 18: Wire familiar-fallback into `route-link`

**Files:**
- Modify: `src/app/api/library/route-link/route.ts`
- Modify: `src/app/api/library/route-link/route.test.ts`

- [ ] **Step 18.1: Inspect the existing chat-send daemon caller**

```bash
grep -nE 'callDaemon|fetch.*daemon|harness' src/app/api/chat/send/route.ts | head -10
```
The harness ask shape varies by harness; we'll use a thin server-side helper that posts a single non-streaming prompt to the configured familiar's harness. If the repo has an existing `askFamiliar` or similar helper, use it. Otherwise, the simplest path is to skip wiring on the server and keep Tier 5 → bookmarks. Document the gap.

- [ ] **Step 18.2: Either wire or document**

**If `askFamiliar` exists:** import it and pass to `classifyWithFamiliar` from inside `routeLinkHandler` when the classifier returns `familiar-fallback`:

```ts
import { classifyWithFamiliar } from "@/lib/familiar-classify";
import { askFamiliar } from "@/lib/coven-daemon"; // or wherever
// ... inside routeLinkHandler:
if (classify.rule === "familiar-fallback") {
  const fam = await loadFamiliar(body.familiar);
  if (fam) {
    classify = await classifyWithFamiliar(body.url, {}, fam, { ask: (p) => askFamiliar(fam.id, p) });
  } else {
    classify = { ...classify, list: "bookmarks" };
  }
}
```

**If no such helper exists:** add this comment block at the top of `routeLinkHandler`:
```ts
// FAMILIAR-FALLBACK: The Tier-5 classifier returns `familiar-fallback`;
// classifyWithFamiliar() is ready to use but the repo does not yet
// expose a non-streaming "ask familiar" helper. Until that lands,
// Tier 5 hosts (twitter.com, x.com, news.ycombinator.com, reddit.com)
// default to bookmarks. See src/lib/familiar-classify.ts for the
// finished helper.
```

- [ ] **Step 18.3: Add a route-test case if helper wired**

If 18.2 wired the helper, add to `src/app/api/library/route-link/route.test.ts`:

```ts
// 8. Ambiguous URL with mocked familiar-ask resolving to 'b' → reading
{
  // mock askFamiliar by stubbing the import in test harness — depends on impl
  // ... (deferred until the daemon helper lands)
}
```

- [ ] **Step 18.4: Typecheck + tests**

```bash
pnpm typecheck
node --test --experimental-strip-types src/app/api/library/route-link/route.test.ts src/lib/familiar-classify.test.ts 2>&1 | tail -10
```
Expected: clean.

- [ ] **Step 18.5: Commit**

```bash
git add src/app/api/library/route-link/route.ts src/app/api/library/route-link/route.test.ts
git commit -S -m "feat(library): wire familiar-fallback into route-link

Tier-5 classifier calls classifyWithFamiliar with a 3s budget
when a daemon ask-familiar helper is available; otherwise
defaults to bookmarks. Helper is documented in route.ts."
```

---

## Final verification gates

Run all of these from `main` after merging the feature branch. Each must pass before the feature is "done."

- [ ] **Step F.1: Typecheck clean**

```bash
pnpm typecheck
```

- [ ] **Step F.2: All new + existing tests pass**

```bash
node --test --experimental-strip-types \
  src/lib/*.test.ts \
  src/components/*.test.ts \
  src/app/api/library/route-link/route.test.ts 2>&1 | tail -10
```
Expected: only the pre-existing `agents-view.test.ts` failure ("Search agents…" vs "Search chats…"); all new tests pass.

- [ ] **Step F.3: Grep — no hardcoded `"sage"` familiar literal in routes**

```bash
rg 'familiar: "sage"' src/app/api/library/
```
Expected: empty.

- [ ] **Step F.4: Dev-server smoke (with the coven daemon online)**

```bash
pkill -f 'next dev' 2>/dev/null; sleep 1
pnpm dev > /tmp/cave-dev.log 2>&1 &
sleep 5
```

Then in the running app:

1. **Chat-scan:** Open a chat with any familiar. Paste `https://arxiv.org/abs/2603.12345`. Send. Inspect `~/.openclaw/workspace/sage/library/reading.json` — new entry with `capture.source.kind === "chat"` and `capture.classifier.rule === "paper-host"`.
2. **Browser-pane Save:** Open Browser. Navigate to `https://example.com`. Click the Save IconButton. Tooltip shows "Saved to Bookmarks". Inspect `bookmarks.json` — new entry with `capture.source.kind === "browser"`.
3. **Slash:** In a chat composer, type `/save https://github.com/foo/bar` and submit. Toast says "Saved to GitHub." Inspect `github.json` — new entry with `capture.source.kind === "slash"`.
4. **Timeline:** Open Library. Default tab is "All". See the three entries in the timeline, newest first, each with list pill + familiar face + source pill + classifier badge.
5. **Group toggle:** Click "Group: date" → flips to "Group: source". The three entries regroup under their source headings.
6. **Familiar filter:** Pick a familiar from the dropdown. The list filters accordingly.
7. **Existing tabs:** Click Bookmarks / Reading / GitHub. Each still loads its own list normally.

```bash
pkill -f 'next dev'
```

- [ ] **Step F.5: Open PR**

```bash
git push -u origin feat/familiar-link-routing
gh pr create --base main --title "feat(library): familiar-driven link routing" --body "$(cat <<'EOF'
## Summary

Implements `docs/superpowers/specs/2026-06-06-familiar-link-routing-design.md` — familiars auto-capture URLs from chat / browser / `/save` and route them into Bookmarks / Reading / GitHub with full source attribution. New unified Library timeline with group-by-source toggle.

## Phases

1. Schema + storage refactor (LinkSource + LinkCapture types; library-store extracted)
2. Pure functions (link-extractor, link-classifier, slash-save-parser) — 16+24+11 fixture cases
3. POST /api/library/route-link — 7 integration cases against a tmp dir
4. GET /api/library/all + LibraryTimeline + LibraryTimelineRow components
5. Three adapters wired (chat-scan, browser-pane Save, /save slash)
6. Drop hardcoded "sage" fallback in the three existing routes
7. Familiar-classify Tier-5 fallback (gated on daemon helper availability)

## Test plan

- [ ] `pnpm typecheck` clean
- [ ] All new tests pass; existing `agents-view.test.ts` failure remains (pre-existing)
- [ ] Manual smoke checklist from spec §Verification

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review notes

**Spec coverage check** (every requirement in `2026-06-06-familiar-link-routing-design.md` mapped to a task):

| Spec section | Implementing task(s) |
|---|---|
| Data model — LinkSource + LinkCapture | Task 1 |
| Data model — optional capture on item types | Task 1 |
| Data model — .index.json | Task 2 (definition) + Task 8 (consumption) |
| Architecture — module boundaries | Tasks 2, 4, 5, 6, 7, 8, 9, 10, 11 |
| Classifier — five-tier rules | Task 5 |
| Classifier — familiar fallback | Task 17, 18 |
| Title sourcing | Task 8 (`titleFromReadingPath`, github via parse, domain for bookmark) |
| Chat-scan adapter | Task 13 |
| Browser-pane Save adapter | Task 14 |
| /save slash adapter | Task 15 |
| RSS / feed contract | Task 7 (stub) |
| POST /api/library/route-link | Task 8 |
| GET /api/library/all | Task 9 |
| LibraryView changes | Task 12 |
| LibraryTimeline component | Task 11 |
| LibraryTimelineRow | Task 10 |
| Empty / loading / keyboard | Task 11 (empty + loading); keyboard chord is left as a UX follow-up (low priority per spec) |
| Errors — invalid URL, dedup, write failure, mutex | Task 8 + Task 2 |
| Errors — familiar timeout / garbage / mismatch | Task 17 |
| Six test files | Tasks 4, 5, 6, 8, 11, 13, 14 (chat-send wiring), 17 (= 8 files actually — over delivers) |
| Cleanup — drop hardcoded "sage" | Task 16 |
| Verification checklist | Final F.1–F.5 |

**Out-of-scope reminders** (explicitly NOT implemented, per spec):
- No backfill of existing chats
- No server-side title fetching
- No RSS poller (only the stubbed `routeFeedItem`)
- No daemon-level extraction

**Placeholder scan:** searched the plan for "TBD", "TODO", "fill in", "similar to". One conditional in Task 18 (familiar-fallback wiring depends on existence of `askFamiliar` helper) — this is acknowledged as a real gating condition with explicit alternate behavior, not a placeholder.

**Type consistency:** `ClassifyResult.list` is `ClassifyList | undefined` so Tier-5 returns can omit it; consumers use `classify.list ?? "bookmarks"`. The `TimelineEntry` type is defined once in `route-link/route.ts`... actually in `all/route.ts` — consumers in `library-timeline.tsx` and `library-timeline-row.tsx` import from `@/app/api/library/all/route` consistently.
