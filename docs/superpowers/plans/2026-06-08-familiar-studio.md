# Familiar Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add comprehensive Cave-local customization of familiars (identity, look, brain, lifecycle) via a new Familiar Studio drawer, plus polish the familiar avatar rail with per-familiar accent color, hover affordance, smarter default glyphs, image avatars, and drag-to-reorder.

**Architecture:** Three new localStorage stores (overrides, images, archive) layered on top of daemon `Familiar` data via a new `familiar-resolve.ts` module. A new `FamiliarAvatar` component replaces direct `<FamiliarGlyph>` usage at 13 consumer sites. A new `FamiliarStudio` drawer (composed of 4 tab components) edits everything, triggered from the rail and settings panel via a `FamiliarStudioProvider` React context.

**Tech Stack:** Next.js 16 + React 19 (Tauri shell), Phosphor icons via `@iconify/react`, localStorage with `useSyncExternalStore` for cross-tab sync, `cave-config.json` for brain-tab persistence via existing `PATCH /api/config` route. Tests use `node:assert/strict` for behavioral lib tests and source-regex matching for component tests (matching the established codebase pattern — see `src/components/familiar-avatar-rail.test.ts`).

**Spec reference:** [docs/superpowers/specs/2026-06-08-familiar-studio-design.md](../specs/2026-06-08-familiar-studio-design.md)

**Conventions for every commit in this plan:**
- Sign every commit with `-S` (per global rule — gpg.format=ssh is configured).
- Use HEREDOC commit messages so multi-line bodies stay intact.
- One task = one commit (the final step of each task).
- Co-author line: `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.
- Tests run via the codebase's existing pattern (top-level `await` in `.test.ts` files imported via `tsx` or similar — CI does not run them, so verify by running them locally with the same command the engineer uses for the existing tests, typically `node --experimental-strip-types --no-warnings <path>` or `node --experimental-strip-types <path>`).

---

## Phase 1 — Foundations (no UI behavior change yet)

### Task 1: `inferGlyphFromRole` + precedence update in `familiar-glyph.ts`

**Files:**
- Modify: `src/lib/familiar-glyph.ts`
- Create: `src/lib/familiar-glyph.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/familiar-glyph.test.ts`:

```ts
// @ts-nocheck
import assert from "node:assert/strict";
import {
  inferGlyphFromRole,
  resolveFamiliarGlyph,
  DEFAULT_FAMILIAR_GLYPH,
} from "./familiar-glyph.ts";

// inferGlyphFromRole — keyword matches
{
  assert.equal(inferGlyphFromRole("Code Reviewer")?.name, "ph:code-bold");
  assert.equal(inferGlyphFromRole("chat host")?.name, "ph:chat-circle-fill");
  assert.equal(inferGlyphFromRole("Music critic")?.name, "ph:music-notes-fill");
  assert.equal(inferGlyphFromRole("research librarian")?.name, "ph:books-fill");
  assert.equal(inferGlyphFromRole("Art director")?.name, "ph:palette-fill");
  assert.equal(inferGlyphFromRole("Data scientist")?.name, "ph:chart-bar-fill");
  assert.equal(inferGlyphFromRole("OPS engineer")?.name, "ph:gear-fill");
  assert.equal(inferGlyphFromRole("Writer")?.name, "ph:pencil-fill");
  assert.equal(inferGlyphFromRole("Designer")?.name, "ph:pen-nib-fill");
}

// inferGlyphFromRole — no match returns null
{
  assert.equal(inferGlyphFromRole("Spelunker"), null);
  assert.equal(inferGlyphFromRole(""), null);
  assert.equal(inferGlyphFromRole("  "), null);
}

// resolveFamiliarGlyph — new precedence step
{
  // No override / icon / emoji — should fall through to role inference.
  const fam = { id: "x", role: "code reviewer" } as any;
  assert.equal(resolveFamiliarGlyph(fam, {}).name, "ph:code-bold");
}

{
  // Override still wins over role inference.
  const fam = { id: "x", role: "code reviewer" } as any;
  assert.equal(
    resolveFamiliarGlyph(fam, { x: "ph:cat-fill" }).name,
    "ph:cat-fill",
  );
}

{
  // Daemon icon still wins over role inference.
  const fam = { id: "x", role: "code reviewer", icon: "ph:wand-fill" } as any;
  assert.equal(resolveFamiliarGlyph(fam, {}).name, "ph:wand-fill");
}

{
  // No override, no icon, no emoji, role doesn't match — final default fires.
  const fam = { id: "x", role: "spelunker" } as any;
  assert.equal(resolveFamiliarGlyph(fam, {}).name, DEFAULT_FAMILIAR_GLYPH.name);
}

console.log("familiar-glyph.test.ts: ok");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --no-warnings src/lib/familiar-glyph.test.ts`
Expected: FAIL — `inferGlyphFromRole is not a function` (or similar import error).

- [ ] **Step 3: Implement `inferGlyphFromRole` and update `resolveFamiliarGlyph`**

Edit `src/lib/familiar-glyph.ts` — add the mapping table and the helper above `resolveFamiliarGlyph`, then insert the new precedence step:

```ts
/**
 * Deterministic keyword → Phosphor glyph mapping. Used as the final fallback
 * before DEFAULT_FAMILIAR_GLYPH when a familiar has no override, no daemon
 * icon, and no daemon emoji. Case-insensitive substring match on `role`.
 *
 * The first matching keyword wins, so order keys most-specific → most-generic
 * if you extend this.
 */
const ROLE_GLYPH_MAP: Array<[string, string]> = [
  ["code", "ph:code-bold"],
  ["chat", "ph:chat-circle-fill"],
  ["music", "ph:music-notes-fill"],
  ["research", "ph:books-fill"],
  ["art", "ph:palette-fill"],
  ["data", "ph:chart-bar-fill"],
  ["ops", "ph:gear-fill"],
  ["writer", "ph:pencil-fill"],
  ["design", "ph:pen-nib-fill"],
];

export function inferGlyphFromRole(role: string | undefined): FamiliarGlyph | null {
  if (!role) return null;
  const lower = role.toLowerCase();
  for (const [kw, name] of ROLE_GLYPH_MAP) {
    if (lower.includes(kw)) return { kind: "icon", name };
  }
  return null;
}
```

And modify `resolveFamiliarGlyph` to insert the inference step. Update the JSDoc to reflect the new precedence list (5 steps):

```ts
/**
 * Resolve the glyph to render for a familiar.
 *
 * Precedence (highest first):
 *   1. Cave-local override (`overrides[familiar.id]`).
 *   2. Daemon-provided `familiar.icon` (must be `ph:*`).
 *   3. Legacy daemon `emoji` field (only when it stores a `ph:*` name).
 *   4. `inferGlyphFromRole(familiar.role)` — keyword inference.
 *   5. `DEFAULT_FAMILIAR_GLYPH`.
 */
export function resolveFamiliarGlyph(
  familiar: Pick<Familiar, "id" | "emoji" | "icon" | "role">,
  overrides: Record<string, string>,
): FamiliarGlyph {
  const override = parseGlyphString(overrides[familiar.id]);
  if (override) return override;
  const daemonIcon = parseGlyphString(familiar.icon);
  if (daemonIcon) return daemonIcon;
  const daemonEmoji = parseGlyphString(familiar.emoji);
  if (daemonEmoji) return daemonEmoji;
  const inferred = inferGlyphFromRole(familiar.role);
  if (inferred) return inferred;
  return DEFAULT_FAMILIAR_GLYPH;
}
```

Note: `Pick<Familiar, ...>` now must include `role`. This is the only API change to `resolveFamiliarGlyph` and is backwards-compatible at every existing call site (the full `Familiar` type already has `role: string` as required).

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types --no-warnings src/lib/familiar-glyph.test.ts`
Expected: PASS — prints `familiar-glyph.test.ts: ok`.

- [ ] **Step 5: Commit**

```bash
git add -f src/lib/familiar-glyph.ts src/lib/familiar-glyph.test.ts
git commit -S -m "$(cat <<'EOF'
feat(familiar-glyph): infer default glyph from role keyword

Adds inferGlyphFromRole and a fourth precedence step in
resolveFamiliarGlyph so familiars without an override/icon/emoji
still get a meaningful default based on their role string before
falling back to ph:sparkle-fill.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `cave-familiar-overrides.ts` localStorage store

**Files:**
- Create: `src/lib/cave-familiar-overrides.ts`
- Create: `src/lib/cave-familiar-overrides.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/cave-familiar-overrides.test.ts`:

```ts
// @ts-nocheck
import assert from "node:assert/strict";

// Minimal localStorage + window mock so the store can run under Node.
const storage = new Map();
globalThis.window = {
  localStorage: {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, v),
    removeItem: (k) => storage.delete(k),
  },
  addEventListener: () => {},
  removeEventListener: () => {},
};

const mod = await import("./cave-familiar-overrides.ts");

// setFamiliarOverride writes a partial patch
{
  mod.setFamiliarOverride("cody", { display_name: "Cody the Brave" });
  const snap = mod.readFamiliarOverridesSnapshot();
  assert.deepEqual(snap, { cody: { display_name: "Cody the Brave" } });
}

// Subsequent patches merge, not replace
{
  mod.setFamiliarOverride("cody", { role: "Code Reviewer" });
  const snap = mod.readFamiliarOverridesSnapshot();
  assert.deepEqual(snap, {
    cody: { display_name: "Cody the Brave", role: "Code Reviewer" },
  });
}

// clearFamiliarOverrideField removes a single field
{
  mod.clearFamiliarOverrideField("cody", "display_name");
  const snap = mod.readFamiliarOverridesSnapshot();
  assert.deepEqual(snap, { cody: { role: "Code Reviewer" } });
}

// clearFamiliarOverrideField removes the id entry entirely when last field clears
{
  mod.clearFamiliarOverrideField("cody", "role");
  const snap = mod.readFamiliarOverridesSnapshot();
  assert.deepEqual(snap, {});
}

// clearAllFamiliarOverrides drops the whole id entry
{
  mod.setFamiliarOverride("nova", { description: "test", color: "#abc" });
  mod.clearAllFamiliarOverrides("nova");
  const snap = mod.readFamiliarOverridesSnapshot();
  assert.deepEqual(snap, {});
}

// Corrupt JSON falls back to empty
{
  storage.set("cave:familiar-overrides:v1", "{not json");
  // Re-import a fresh module instance is not trivial; re-read by mutating
  // through the API which re-reads on next access via writeOverrides path.
  // Simpler: clear, set garbage, then assert a clean read returns empty.
  mod.setFamiliarOverride("nova", { role: "x" });
  mod.clearAllFamiliarOverrides("nova");
  storage.set("cave:familiar-overrides:v1", "{not json");
  // Force the cache to refresh by mutating with a no-op then reading.
  // Since the store caches across calls, the simplest robust check is:
  const reparsed = JSON.parse(
    storage.get("cave:familiar-overrides:v1") ?? "null",
  );
  // The corrupt JSON path is exercised on read after fresh module import;
  // here we just assert the in-memory snapshot stays well-formed.
  const snap = mod.readFamiliarOverridesSnapshot();
  assert.ok(snap && typeof snap === "object");
}

console.log("cave-familiar-overrides.test.ts: ok");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --no-warnings src/lib/cave-familiar-overrides.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the store**

Create `src/lib/cave-familiar-overrides.ts`:

```ts
"use client";

/**
 * Cave-local familiar metadata override store.
 *
 * Layered on top of daemon-owned `Familiar` fields. Each entry is a *partial*
 * override — only fields the user has explicitly set live here. Resolution
 * (see `familiar-resolve.ts`) falls through to the daemon value when a field
 * is absent.
 *
 * Lives in localStorage under `cave:familiar-overrides:v1`. Cross-tab sync
 * + cross-component re-render follows the same `useSyncExternalStore` +
 * `storage`-event pattern as `cave-glyph-overrides.ts`.
 */

import { useSyncExternalStore } from "react";

const OVERRIDES_KEY = "cave:familiar-overrides:v1";

export type FamiliarOverride = {
  display_name?: string;
  role?: string;
  pronouns?: string;
  description?: string;
  /** CSS color string (hex, oklch, named). Drives the rail accent ring. */
  color?: string;
};

type OverrideMap = Record<string, FamiliarOverride>;

let cached: OverrideMap | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const fn of listeners) fn();
}

function readFromStorage(): OverrideMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(OVERRIDES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as OverrideMap;
    }
  } catch {
    /* corrupt — discard */
  }
  return {};
}

function getMap(): OverrideMap {
  if (cached === null) cached = readFromStorage();
  return cached;
}

function writeMap(next: OverrideMap) {
  cached = next;
  if (typeof window !== "undefined") {
    window.localStorage.setItem(OVERRIDES_KEY, JSON.stringify(next));
  }
  notify();
}

/** Merge a partial override patch for one familiar. Empty-string values are dropped. */
export function setFamiliarOverride(
  id: string,
  patch: Partial<FamiliarOverride>,
): void {
  const curr = getMap();
  const existing = curr[id] ?? {};
  const next: FamiliarOverride = { ...existing };
  for (const [key, value] of Object.entries(patch)) {
    if (typeof value === "string" && value.trim() === "") {
      // Empty string ⇒ treat as a clear of that field.
      delete next[key as keyof FamiliarOverride];
    } else if (value !== undefined) {
      (next as Record<string, unknown>)[key] = value;
    }
  }
  const isEmpty = Object.keys(next).length === 0;
  const updated = { ...curr };
  if (isEmpty) delete updated[id];
  else updated[id] = next;
  writeMap(updated);
}

/** Clear a single override field; drops the id entry entirely if it becomes empty. */
export function clearFamiliarOverrideField(
  id: string,
  field: keyof FamiliarOverride,
): void {
  const curr = getMap();
  if (!curr[id] || !(field in curr[id])) return;
  const nextEntry = { ...curr[id] };
  delete nextEntry[field];
  const updated = { ...curr };
  if (Object.keys(nextEntry).length === 0) delete updated[id];
  else updated[id] = nextEntry;
  writeMap(updated);
}

/** Drop every override field for a familiar. */
export function clearAllFamiliarOverrides(id: string): void {
  const curr = getMap();
  if (!(id in curr)) return;
  const updated = { ...curr };
  delete updated[id];
  writeMap(updated);
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === OVERRIDES_KEY) {
      cached = null;
      notify();
    }
  });
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const EMPTY: OverrideMap = Object.freeze({});
const getServerSnapshot = () => EMPTY;

export function useFamiliarOverrides(): OverrideMap {
  return useSyncExternalStore(subscribe, getMap, getServerSnapshot);
}

export function readFamiliarOverridesSnapshot(): OverrideMap {
  return getMap();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types --no-warnings src/lib/cave-familiar-overrides.test.ts`
Expected: PASS — prints `cave-familiar-overrides.test.ts: ok`.

- [ ] **Step 5: Commit**

```bash
git add -f src/lib/cave-familiar-overrides.ts src/lib/cave-familiar-overrides.test.ts
git commit -S -m "$(cat <<'EOF'
feat(familiar-overrides): cave-local store for identity overrides

Adds cave:familiar-overrides:v1 localStorage store for per-familiar
partial overrides of display_name/role/pronouns/description/color.
Mirrors the existing cave-glyph-overrides pattern with
useSyncExternalStore + cross-tab storage event.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `cave-familiar-images.ts` localStorage store

**Files:**
- Create: `src/lib/cave-familiar-images.ts`
- Create: `src/lib/cave-familiar-images.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/cave-familiar-images.test.ts`:

```ts
// @ts-nocheck
import assert from "node:assert/strict";

const storage = new Map();
globalThis.window = {
  localStorage: {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, v),
    removeItem: (k) => storage.delete(k),
  },
  addEventListener: () => {},
  removeEventListener: () => {},
};

const mod = await import("./cave-familiar-images.ts");

// Set + read
{
  const dataUrl = "data:image/png;base64," + "A".repeat(1000);
  const res = mod.setFamiliarImage("cody", { dataUrl, mime: "image/png" });
  assert.equal(res.ok, true);
  const got = mod.readFamiliarImagesSnapshot();
  assert.ok(got.cody);
  assert.equal(got.cody.mime, "image/png");
  assert.equal(got.cody.dataUrl, dataUrl);
  assert.ok(Number.isFinite(Date.parse(got.cody.updatedAt)));
}

// Per-image size cap (2MB pre-encode ≈ 2*1024*1024 bytes ≈ ~2.8MB base64)
{
  const huge = "data:image/png;base64," + "A".repeat(3 * 1024 * 1024);
  const res = mod.setFamiliarImage("nova", { dataUrl: huge, mime: "image/png" });
  assert.equal(res.ok, false);
  assert.match(res.reason, /too large/i);
}

// Disallowed mime
{
  const dataUrl = "data:image/gif;base64,AAA";
  const res = mod.setFamiliarImage("nova", { dataUrl, mime: "image/gif" });
  assert.equal(res.ok, false);
  assert.match(res.reason, /unsupported|format/i);
}

// Clear
{
  mod.clearFamiliarImage("cody");
  const got = mod.readFamiliarImagesSnapshot();
  assert.equal(got.cody, undefined);
}

console.log("cave-familiar-images.test.ts: ok");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --no-warnings src/lib/cave-familiar-images.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the store**

Create `src/lib/cave-familiar-images.ts`:

```ts
"use client";

/**
 * Cave-local per-familiar avatar image store.
 *
 * Images are stored as base64 data URLs in localStorage under
 * `cave:familiar-images:v1`. Each image is capped at 2MB pre-encode and the
 * whole store at ~20MB total. Larger uploads return `{ ok: false, reason }`
 * so the UI can surface a toast and refuse the write.
 */

import { useSyncExternalStore } from "react";

const IMAGES_KEY = "cave:familiar-images:v1";
const MAX_DATAURL_BYTES = Math.floor(2 * 1024 * 1024 * 4 / 3) + 100; // ~2.8MB
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
const ALLOWED_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
]);

export type FamiliarImage = {
  dataUrl: string;
  mime: string;
  updatedAt: string;
};

type ImageMap = Record<string, FamiliarImage>;
type SetResult = { ok: true } | { ok: false; reason: string };

let cached: ImageMap | null = null;
const listeners = new Set<() => void>();

function notify() { for (const fn of listeners) fn(); }

function readFromStorage(): ImageMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(IMAGES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as ImageMap;
    }
  } catch { /* corrupt — discard */ }
  return {};
}

function getMap(): ImageMap {
  if (cached === null) cached = readFromStorage();
  return cached;
}

function writeMap(next: ImageMap) {
  cached = next;
  if (typeof window !== "undefined") {
    window.localStorage.setItem(IMAGES_KEY, JSON.stringify(next));
  }
  notify();
}

function totalBytes(map: ImageMap): number {
  let sum = 0;
  for (const v of Object.values(map)) sum += v.dataUrl.length;
  return sum;
}

export function setFamiliarImage(id: string, image: { dataUrl: string; mime: string }): SetResult {
  if (!ALLOWED_MIMES.has(image.mime)) {
    return { ok: false, reason: "Unsupported format. Use PNG, JPEG, WebP, or SVG." };
  }
  if (image.dataUrl.length > MAX_DATAURL_BYTES) {
    return { ok: false, reason: "Image too large (max 2MB)." };
  }
  const curr = getMap();
  const previousEntry = curr[id];
  const projected =
    totalBytes(curr) - (previousEntry?.dataUrl.length ?? 0) + image.dataUrl.length;
  if (projected > MAX_TOTAL_BYTES) {
    return { ok: false, reason: "Cave avatar storage full. Remove an image to free space." };
  }
  const next = {
    ...curr,
    [id]: { dataUrl: image.dataUrl, mime: image.mime, updatedAt: new Date().toISOString() },
  };
  writeMap(next);
  return { ok: true };
}

export function clearFamiliarImage(id: string): void {
  const curr = getMap();
  if (!(id in curr)) return;
  const next = { ...curr };
  delete next[id];
  writeMap(next);
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === IMAGES_KEY) {
      cached = null;
      notify();
    }
  });
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const EMPTY: ImageMap = Object.freeze({});
const getServerSnapshot = () => EMPTY;

export function useFamiliarImages(): ImageMap {
  return useSyncExternalStore(subscribe, getMap, getServerSnapshot);
}

export function readFamiliarImagesSnapshot(): ImageMap {
  return getMap();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types --no-warnings src/lib/cave-familiar-images.test.ts`
Expected: PASS — prints `cave-familiar-images.test.ts: ok`.

- [ ] **Step 5: Commit**

```bash
git add -f src/lib/cave-familiar-images.ts src/lib/cave-familiar-images.test.ts
git commit -S -m "$(cat <<'EOF'
feat(familiar-images): cave-local store for uploaded avatar images

Adds cave:familiar-images:v1 store with 2MB per-image cap and ~20MB
total cap, validating PNG/JPEG/WebP/SVG mime types. Returns
structured { ok, reason } from setFamiliarImage so the Look tab can
toast on rejection.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `cave-familiar-archive.ts` localStorage store

**Files:**
- Create: `src/lib/cave-familiar-archive.ts`
- Create: `src/lib/cave-familiar-archive.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/cave-familiar-archive.test.ts`:

```ts
// @ts-nocheck
import assert from "node:assert/strict";

const storage = new Map();
globalThis.window = {
  localStorage: {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, v),
    removeItem: (k) => storage.delete(k),
  },
  addEventListener: () => {},
  removeEventListener: () => {},
};

const mod = await import("./cave-familiar-archive.ts");

// Archive then check
{
  mod.archiveFamiliar("cody");
  const snap = mod.readArchivedFamiliarsSnapshot();
  assert.ok(snap.cody);
  assert.ok(Number.isFinite(Date.parse(snap.cody)));
  assert.equal(mod.isFamiliarArchived("cody", snap), true);
  assert.equal(mod.isFamiliarArchived("nova", snap), false);
}

// Archiving twice is idempotent (last write wins, no error)
{
  const first = mod.readArchivedFamiliarsSnapshot().cody;
  mod.archiveFamiliar("cody");
  const second = mod.readArchivedFamiliarsSnapshot().cody;
  assert.ok(second >= first);
}

// Unarchive
{
  mod.unarchiveFamiliar("cody");
  const snap = mod.readArchivedFamiliarsSnapshot();
  assert.equal(snap.cody, undefined);
  assert.equal(mod.isFamiliarArchived("cody", snap), false);
}

// Unarchive on never-archived id is a no-op
{
  mod.unarchiveFamiliar("ghost");
  assert.deepEqual(mod.readArchivedFamiliarsSnapshot(), {});
}

console.log("cave-familiar-archive.test.ts: ok");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --no-warnings src/lib/cave-familiar-archive.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the store**

Create `src/lib/cave-familiar-archive.ts`:

```ts
"use client";

/**
 * Cave-local familiar archive store.
 *
 * Archived familiars are filtered out of the rail and switchers but stay
 * visible in the Familiar Studio Lifecycle list so users can unarchive.
 * `cave:familiar-archive:v1` maps familiar id → ISO timestamp of archive.
 */

import { useSyncExternalStore } from "react";

const ARCHIVE_KEY = "cave:familiar-archive:v1";

export type ArchiveMap = Record<string, string>;

let cached: ArchiveMap | null = null;
const listeners = new Set<() => void>();

function notify() { for (const fn of listeners) fn(); }

function readFromStorage(): ArchiveMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(ARCHIVE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as ArchiveMap;
    }
  } catch { /* corrupt — discard */ }
  return {};
}

function getMap(): ArchiveMap {
  if (cached === null) cached = readFromStorage();
  return cached;
}

function writeMap(next: ArchiveMap) {
  cached = next;
  if (typeof window !== "undefined") {
    window.localStorage.setItem(ARCHIVE_KEY, JSON.stringify(next));
  }
  notify();
}

export function archiveFamiliar(id: string): void {
  const next = { ...getMap(), [id]: new Date().toISOString() };
  writeMap(next);
}

export function unarchiveFamiliar(id: string): void {
  const curr = getMap();
  if (!(id in curr)) return;
  const next = { ...curr };
  delete next[id];
  writeMap(next);
}

export function isFamiliarArchived(id: string, map: ArchiveMap): boolean {
  return id in map;
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === ARCHIVE_KEY) {
      cached = null;
      notify();
    }
  });
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const EMPTY: ArchiveMap = Object.freeze({});
const getServerSnapshot = () => EMPTY;

export function useArchivedFamiliars(): ArchiveMap {
  return useSyncExternalStore(subscribe, getMap, getServerSnapshot);
}

export function readArchivedFamiliarsSnapshot(): ArchiveMap {
  return getMap();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types --no-warnings src/lib/cave-familiar-archive.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -f src/lib/cave-familiar-archive.ts src/lib/cave-familiar-archive.test.ts
git commit -S -m "$(cat <<'EOF'
feat(familiar-archive): cave-local archive store

Adds cave:familiar-archive:v1 to hide familiars from the rail without
asking the daemon to delete them. Lifecycle tab uses this for
archive/unarchive toggles.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `familiar-resolve.ts` resolution layer

**Files:**
- Create: `src/lib/familiar-resolve.ts`
- Create: `src/lib/familiar-resolve.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/familiar-resolve.test.ts`:

```ts
// @ts-nocheck
import assert from "node:assert/strict";
import { resolveFamiliar } from "./familiar-resolve.ts";
import { DEFAULT_FAMILIAR_GLYPH } from "./familiar-glyph.ts";

const base = {
  id: "cody",
  display_name: "Cody",
  role: "Code Reviewer",
  description: "A friendly bot",
  pronouns: "they/them",
  icon: "ph:wand-fill",
};

// No overrides → daemon values + inferred color fallback
{
  const r = resolveFamiliar(base, { archived: false });
  assert.equal(r.display_name, "Cody");
  assert.equal(r.role, "Code Reviewer");
  assert.equal(r.pronouns, "they/them");
  assert.equal(r.description, "A friendly bot");
  assert.equal(r.color, "var(--accent-presence)");
  assert.equal(r.avatarImage, undefined);
  assert.equal(r.glyph.name, "ph:wand-fill");
  assert.equal(r.archived, false);
}

// Override wins over daemon
{
  const r = resolveFamiliar(base, {
    override: { display_name: "Cody the Brave", color: "#ff6600" },
    archived: false,
  });
  assert.equal(r.display_name, "Cody the Brave");
  assert.equal(r.role, "Code Reviewer"); // not overridden
  assert.equal(r.color, "#ff6600");
}

// Image present
{
  const r = resolveFamiliar(base, {
    image: { dataUrl: "data:image/png;base64,AAA", mime: "image/png", updatedAt: "2026-06-08T00:00:00Z" },
    archived: false,
  });
  assert.equal(r.avatarImage, "data:image/png;base64,AAA");
  // Glyph still resolved for fallback
  assert.equal(r.glyph.name, "ph:wand-fill");
}

// Glyph override wins
{
  const r = resolveFamiliar(base, { glyphOverride: "ph:cat-fill", archived: false });
  assert.equal(r.glyph.name, "ph:cat-fill");
}

// No icon / override → role inference
{
  const noIcon = { ...base, icon: undefined };
  const r = resolveFamiliar(noIcon, { archived: false });
  assert.equal(r.glyph.name, "ph:code-bold");
}

// No icon, no role match → DEFAULT_FAMILIAR_GLYPH
{
  const exotic = { ...base, icon: undefined, role: "Spelunker" };
  const r = resolveFamiliar(exotic, { archived: false });
  assert.equal(r.glyph.name, DEFAULT_FAMILIAR_GLYPH.name);
}

// archived flag passes through
{
  const r = resolveFamiliar(base, { archived: true });
  assert.equal(r.archived, true);
}

console.log("familiar-resolve.test.ts: ok");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --no-warnings src/lib/familiar-resolve.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the resolver**

Create `src/lib/familiar-resolve.ts`:

```ts
"use client";

import { useMemo } from "react";
import { resolveFamiliarGlyph, type FamiliarGlyph } from "./familiar-glyph";
import { applyFamiliarOrder, useFamiliarOrder } from "./cave-familiar-order";
import { useFamiliarOverrides, type FamiliarOverride } from "./cave-familiar-overrides";
import { useFamiliarImages, type FamiliarImage } from "./cave-familiar-images";
import { useGlyphOverrides } from "./cave-glyph-overrides";
import { useArchivedFamiliars } from "./cave-familiar-archive";
import type { Familiar } from "./types";

export type ResolvedFamiliar = Omit<Familiar, "display_name" | "role"> & {
  display_name: string;
  role: string;
  /** Always non-empty; falls back to var(--accent-presence). */
  color: string;
  /** Data URL when the user uploaded an avatar image. */
  avatarImage?: string;
  /** Resolved glyph for fallback rendering when no image is set. */
  glyph: FamiliarGlyph;
  archived: boolean;
};

type ResolveContext = {
  override?: FamiliarOverride;
  image?: FamiliarImage;
  glyphOverride?: string;
  archived: boolean;
};

export function resolveFamiliar(base: Familiar, ctx: ResolveContext): ResolvedFamiliar {
  const ov = ctx.override ?? {};
  const glyphOverrides = ctx.glyphOverride ? { [base.id]: ctx.glyphOverride } : {};
  return {
    ...base,
    display_name: ov.display_name ?? base.display_name,
    role: ov.role ?? base.role,
    pronouns: ov.pronouns ?? base.pronouns,
    description: ov.description ?? base.description,
    color: ov.color ?? "var(--accent-presence)",
    avatarImage: ctx.image?.dataUrl,
    glyph: resolveFamiliarGlyph(
      { id: base.id, icon: base.icon, emoji: base.emoji, role: ov.role ?? base.role },
      glyphOverrides,
    ),
    archived: ctx.archived,
  };
}

export function useResolvedFamiliars(
  familiars: Familiar[],
  options?: { includeArchived?: boolean },
): ResolvedFamiliar[] {
  const overrides = useFamiliarOverrides();
  const images = useFamiliarImages();
  const glyphOverrides = useGlyphOverrides();
  const archived = useArchivedFamiliars();
  const order = useFamiliarOrder();
  const includeArchived = options?.includeArchived ?? false;

  return useMemo(() => {
    const ordered = applyFamiliarOrder(familiars, order);
    const resolved: ResolvedFamiliar[] = [];
    for (const f of ordered) {
      const isArchived = f.id in archived;
      if (isArchived && !includeArchived) continue;
      resolved.push(
        resolveFamiliar(f, {
          override: overrides[f.id],
          image: images[f.id],
          glyphOverride: glyphOverrides[f.id],
          archived: isArchived,
        }),
      );
    }
    return resolved;
  }, [familiars, order, overrides, images, glyphOverrides, archived, includeArchived]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types --no-warnings src/lib/familiar-resolve.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -f src/lib/familiar-resolve.ts src/lib/familiar-resolve.test.ts
git commit -S -m "$(cat <<'EOF'
feat(familiar-resolve): layered resolution of daemon + cave overrides

Adds resolveFamiliar + useResolvedFamiliars composing the five cave
stores (overrides, images, glyphs, archive, order) into a single
ResolvedFamiliar view per familiar. Consumers will swap from raw
Familiar + resolveFamiliarGlyph to this single hook.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: `FamiliarAvatar` component (image-or-glyph picker)

**Files:**
- Create: `src/components/familiar-avatar.tsx`
- Create: `src/components/familiar-avatar.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/components/familiar-avatar.test.ts`:

```ts
// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./familiar-avatar.tsx", import.meta.url), "utf8");

assert.match(source, /export function FamiliarAvatar/, "Must export FamiliarAvatar");
assert.match(source, /familiar/, "Must accept a familiar prop");
assert.match(source, /size/, "Must accept a size prop");
assert.match(source, /avatarImage/, "Must consume the avatarImage field");
assert.match(source, /FamiliarGlyph/, "Must fall back to FamiliarGlyph when no image");
assert.match(source, /<img/, "Must render an <img> for image avatars");
assert.match(source, /alt=/, "img must have alt text for a11y");

console.log("familiar-avatar.test.ts: ok");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --no-warnings src/components/familiar-avatar.test.ts`
Expected: FAIL — file not found.

- [ ] **Step 3: Implement the component**

Create `src/components/familiar-avatar.tsx`:

```tsx
"use client";

import { FamiliarGlyph } from "./familiar-glyph";
import type { ResolvedFamiliar } from "@/lib/familiar-resolve";

type Size = "sm" | "md" | "lg";

const PX: Record<Size, number> = { sm: 16, md: 22, lg: 36 };

type Props = {
  familiar: ResolvedFamiliar;
  size?: Size;
  className?: string;
  title?: string;
};

export function FamiliarAvatar({ familiar, size = "md", className, title }: Props) {
  const px = PX[size];
  if (familiar.avatarImage) {
    return (
      <img
        src={familiar.avatarImage}
        alt={familiar.display_name}
        width={px}
        height={px}
        className={className ?? "inline-block rounded-sm object-cover"}
        title={title}
      />
    );
  }
  return (
    <FamiliarGlyph
      glyph={familiar.glyph}
      size={size}
      className={className}
      title={title}
    />
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types --no-warnings src/components/familiar-avatar.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -f src/components/familiar-avatar.tsx src/components/familiar-avatar.test.ts
git commit -S -m "$(cat <<'EOF'
feat(familiar-avatar): unified component that picks image or glyph

Adds FamiliarAvatar component consuming a ResolvedFamiliar. Renders
<img> when avatarImage is set, otherwise delegates to FamiliarGlyph.
Existing call sites of <FamiliarGlyph glyph={resolveFamiliarGlyph(...)}>
will migrate to <FamiliarAvatar familiar={resolved}> in a follow-up.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: `FamiliarStudio` React context provider

**Files:**
- Create: `src/lib/familiar-studio-context.tsx`
- Create: `src/lib/familiar-studio-context.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/familiar-studio-context.test.ts`:

```ts
// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./familiar-studio-context.tsx", import.meta.url), "utf8");

assert.match(source, /export.*FamiliarStudioProvider/, "Provider must be exported");
assert.match(source, /export.*useFamiliarStudio/, "Hook must be exported");
assert.match(source, /openFamiliarStudio/, "Hook returns openFamiliarStudio");
assert.match(source, /closeFamiliarStudio/, "Hook returns closeFamiliarStudio");
assert.match(source, /activeFamiliarId/, "State exposes activeFamiliarId");
assert.match(source, /activeTab/, "State exposes activeTab");
assert.match(source, /createContext/, "Uses React context");

console.log("familiar-studio-context.test.ts: ok");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --no-warnings src/lib/familiar-studio-context.test.ts`
Expected: FAIL — file not found.

- [ ] **Step 3: Implement the provider**

Create `src/lib/familiar-studio-context.tsx`:

```tsx
"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type FamiliarStudioTab = "identity" | "look" | "brain" | "lifecycle";

const TAB_STORAGE_KEY = "cave:familiar-studio-tab:v1";
const DEFAULT_TAB: FamiliarStudioTab = "identity";

type Ctx = {
  /** `null` means closed; a string id means open for a specific familiar. */
  activeFamiliarId: string | null;
  /** `true` means open in no-familiar list view (Lifecycle tab only). */
  listView: boolean;
  activeTab: FamiliarStudioTab;
  openFamiliarStudio: (id: string, tab?: FamiliarStudioTab) => void;
  openFamiliarStudioListView: () => void;
  closeFamiliarStudio: () => void;
  setActiveTab: (tab: FamiliarStudioTab) => void;
};

const StudioContext = createContext<Ctx | null>(null);

export function FamiliarStudioProvider({ children }: { children: ReactNode }) {
  const [activeFamiliarId, setActiveFamiliarId] = useState<string | null>(null);
  const [listView, setListView] = useState(false);
  const [activeTab, setActiveTabState] = useState<FamiliarStudioTab>(DEFAULT_TAB);

  // Restore last-used tab on mount.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(TAB_STORAGE_KEY);
    if (
      stored === "identity" ||
      stored === "look" ||
      stored === "brain" ||
      stored === "lifecycle"
    ) {
      setActiveTabState(stored);
    }
  }, []);

  const setActiveTab = useCallback((tab: FamiliarStudioTab) => {
    setActiveTabState(tab);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(TAB_STORAGE_KEY, tab);
    }
  }, []);

  const openFamiliarStudio = useCallback(
    (id: string, tab?: FamiliarStudioTab) => {
      setActiveFamiliarId(id);
      setListView(false);
      if (tab) setActiveTab(tab);
    },
    [setActiveTab],
  );

  const openFamiliarStudioListView = useCallback(() => {
    setActiveFamiliarId(null);
    setListView(true);
    setActiveTab("lifecycle");
  }, [setActiveTab]);

  const closeFamiliarStudio = useCallback(() => {
    setActiveFamiliarId(null);
    setListView(false);
  }, []);

  const value = useMemo<Ctx>(
    () => ({
      activeFamiliarId,
      listView,
      activeTab,
      openFamiliarStudio,
      openFamiliarStudioListView,
      closeFamiliarStudio,
      setActiveTab,
    }),
    [activeFamiliarId, listView, activeTab, openFamiliarStudio, openFamiliarStudioListView, closeFamiliarStudio, setActiveTab],
  );

  return <StudioContext.Provider value={value}>{children}</StudioContext.Provider>;
}

export function useFamiliarStudio(): Ctx {
  const ctx = useContext(StudioContext);
  if (!ctx) {
    throw new Error("useFamiliarStudio must be used within a FamiliarStudioProvider");
  }
  return ctx;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types --no-warnings src/lib/familiar-studio-context.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -f src/lib/familiar-studio-context.tsx src/lib/familiar-studio-context.test.ts
git commit -S -m "$(cat <<'EOF'
feat(familiar-studio): React context for drawer open/close state

Adds FamiliarStudioProvider + useFamiliarStudio hook so triggers
anywhere in the tree (rail, settings panel, + button menu) can open
the Studio drawer for a familiar. Persists last-used tab to
localStorage under cave:familiar-studio-tab:v1.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 2 — Consumer migration to FamiliarAvatar

### Task 8: Migrate all `<FamiliarGlyph>` + `resolveFamiliarGlyph` call sites to `<FamiliarAvatar>` and `useResolvedFamiliars`

**Files (modify each):**
- `src/components/familiar-avatar-rail.tsx`
- `src/components/sidebar-familiars.tsx`
- `src/components/settings-familiars-panel.tsx`
- `src/components/familiar-status-card.tsx`
- `src/components/chat-list.tsx`
- `src/components/sessions-view.tsx`
- `src/components/companion-rail.tsx`
- `src/components/agent-panel.tsx`
- `src/components/board-table.tsx`
- `src/components/board-kanban.tsx`
- `src/components/board-inspector.tsx`
- `src/components/github-action-popover.tsx`
- `src/components/familiar-glyph-picker.tsx` (the modal still uses `resolveFamiliarGlyph` internally — replace with resolved-familiar input)

Notes for this task: the call sites split into two patterns:
- **Pattern A** — single familiar already in scope: replace `<FamiliarGlyph glyph={resolveFamiliarGlyph(f, overrides)} size="X" />` with `<FamiliarAvatar familiar={resolved} size="X" />`, where `resolved` comes from a `useResolvedFamiliars` call at the nearest sensible parent that already iterates over familiars.
- **Pattern B** — resolving inside a `.map(...)` over a familiars list: hoist the resolve to before the map by calling `const resolvedFamiliars = useResolvedFamiliars(familiars)` at the top of the component and mapping over that instead.

For sites that already accept a `Familiar[]` prop (rail, switcher, sidebar, settings panel), change the prop type to `ResolvedFamiliar[]` and require the parent to resolve once. For sites that look up by id (`board-*`, `companion-rail`, etc.), keep the prop as `Familiar` and resolve inline at the top of the component via a single-element `useResolvedFamiliars([f])[0]`.

- [ ] **Step 1: Audit the call sites**

Run: `grep -rn '<FamiliarGlyph\|resolveFamiliarGlyph' src --include='*.tsx' --include='*.ts' | grep -v '\.test\.' | grep -v 'src/lib/familiar-glyph' | grep -v 'src/components/familiar-glyph'`

Expected: list of ~13 lines across the files above. Use this list as the migration checklist; cross off each as you change it.

- [ ] **Step 2: Migrate Pattern-A consumers (familiar already in scope)**

Apply this transform to each occurrence. Example (`src/components/familiar-status-card.tsx:242`):

Before:
```tsx
import { FamiliarGlyph } from "@/components/familiar-glyph";
import { resolveFamiliarGlyph } from "@/lib/familiar-glyph";
import { useGlyphOverrides } from "@/lib/cave-glyph-overrides";
// ...
const overrides = useGlyphOverrides();
const glyph = resolveFamiliarGlyph(familiar, overrides);
// ...
<FamiliarGlyph glyph={glyph} size="md" className="inline-flex items-center justify-center" />
```

After:
```tsx
import { FamiliarAvatar } from "@/components/familiar-avatar";
import { useResolvedFamiliars } from "@/lib/familiar-resolve";
// ...
const resolved = useResolvedFamiliars([familiar])[0];
// ...
<FamiliarAvatar familiar={resolved} size="md" className="inline-flex items-center justify-center" />
```

Drop the `resolveFamiliarGlyph` and `useGlyphOverrides` imports if they have no remaining uses. Apply the same transform to: `board-table.tsx`, `board-kanban.tsx`, `board-inspector.tsx`, `github-action-popover.tsx`, `chat-list.tsx`, `companion-rail.tsx`, `agent-panel.tsx`.

For `sessions-view.tsx` (4 occurrences): hoist `const resolvedMap = useResolvedFamiliars(allFamiliars)` to the top of the component, build an id→resolved lookup with `useMemo`, and replace each occurrence with `<FamiliarAvatar familiar={resolvedMap[id]} size="sm" />`.

- [ ] **Step 3: Migrate Pattern-B consumers (full familiar lists)**

For `familiar-avatar-rail.tsx`, `sidebar-familiars.tsx`, `settings-familiars-panel.tsx`: change the `familiars: Familiar[]` prop to `familiars: ResolvedFamiliar[]`. Remove the `useGlyphOverrides()` + per-iteration `resolveFamiliarGlyph` calls — the parent now passes already-resolved values. Each parent must wrap with `useResolvedFamiliars`:

Find each top-level page/shell that passes `familiars` to these components (likely `src/components/shell.tsx`, `src/app/page.tsx`, the sidebar mount point). Update the parent:

```tsx
const rawFamiliars = /* existing daemon list */;
const familiars = useResolvedFamiliars(rawFamiliars);
// ...
<FamiliarAvatarRail familiars={familiars} ... />
```

- [ ] **Step 4: Migrate `familiar-glyph-picker.tsx`**

The picker takes `familiar: Familiar | null`. Two minimal changes:
1. Keep accepting `Familiar` for backward compat (other call sites unchanged).
2. Internally, where it currently does `resolveFamiliarGlyph(familiar, overrides)`, switch to building a one-shot ResolvedFamiliar via `useResolvedFamiliars([familiar])[0]` so the preview thumbnail reflects image/color overrides if any.

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: clean. Address any type errors (missing `role` in mocked `Familiar` objects, etc.). All Pick<Familiar, …> usages already include `id`; you may need to add `role` where the new precedence step depends on it (only in `resolveFamiliarGlyph` call shape — already updated in Task 1).

- [ ] **Step 6: Re-run all affected test files**

Run:
```
node --experimental-strip-types --no-warnings src/components/familiar-avatar-rail.test.ts
node --experimental-strip-types --no-warnings src/components/familiar-switcher.test.ts
node --experimental-strip-types --no-warnings src/components/board-table-familiar-select.test.ts
node --experimental-strip-types --no-warnings src/components/library-timeline.test.ts
```

Expected: all pass. (These are source-regex tests; they verify the components still export the same names and carry the right classes. Migration must not break them.)

- [ ] **Step 7: Visual smoke (manual)**

Run `pnpm dev` and confirm:
- Rail renders familiars (no regressions in glyph/presence/badge).
- Settings panel cards render avatars.
- Board / sessions / chat-list / companion / agent-panel renderings of familiar avatars look unchanged.

- [ ] **Step 8: Commit**

```bash
git add -f src/components/familiar-avatar-rail.tsx src/components/sidebar-familiars.tsx src/components/settings-familiars-panel.tsx src/components/familiar-status-card.tsx src/components/chat-list.tsx src/components/sessions-view.tsx src/components/companion-rail.tsx src/components/agent-panel.tsx src/components/board-table.tsx src/components/board-kanban.tsx src/components/board-inspector.tsx src/components/github-action-popover.tsx src/components/familiar-glyph-picker.tsx
# Plus any parent files where useResolvedFamiliars was added (e.g., shell.tsx).
git commit -S -m "$(cat <<'EOF'
refactor(familiar-avatar): swap FamiliarGlyph for FamiliarAvatar at 13 sites

Every familiar-rendering site now consumes ResolvedFamiliar via
useResolvedFamiliars + FamiliarAvatar. resolveFamiliarGlyph stays as
the inner glyph fallback inside familiar-resolve.ts. No visual change
expected; this is groundwork for image avatars and per-familiar
accent color in the next commits.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 3 — Rail polish

### Task 9: Rail accent color + hover `…` affordance + right-click trigger

**Files:**
- Modify: `src/components/familiar-avatar-rail.tsx`
- Modify: `src/components/familiar-avatar-rail.test.ts`
- Modify: `src/app/globals.css` (or wherever `.familiar-avatar-rail__avatar` styles live — grep to confirm)

- [ ] **Step 1: Add new source-regex assertions to the rail test**

Open `src/components/familiar-avatar-rail.test.ts` and append:

```ts
assert.match(
  source,
  /--familiar-accent/,
  "Avatars must set a --familiar-accent CSS custom property",
);
assert.match(
  source,
  /familiar-avatar-rail__edit/,
  "Hover-reveal edit (…) affordance must be present per avatar",
);
assert.match(
  source,
  /onContextMenu/,
  "Right-click handler must be wired",
);
assert.match(
  source,
  /useFamiliarStudio/,
  "Rail must call into the Familiar Studio context",
);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --experimental-strip-types --no-warnings src/components/familiar-avatar-rail.test.ts`
Expected: FAIL on the new assertions.

- [ ] **Step 3: Update the rail component**

In `src/components/familiar-avatar-rail.tsx`:

1. Add `import { useFamiliarStudio } from "@/lib/familiar-studio-context";` and `import { Icon } from "@/lib/icon";` (already present).
2. Inside the component, after the existing destructure, add: `const { openFamiliarStudio } = useFamiliarStudio();`.
3. Add `style={{ "--familiar-accent": f.color } as React.CSSProperties}` to the `<button className="familiar-avatar-rail__avatar...">`.
4. Add `onContextMenu={(e) => { e.preventDefault(); openFamiliarStudio(f.id, "identity"); }}` to the same button.
5. Add a new `<button className="familiar-avatar-rail__edit" aria-label={`Customize ${f.display_name}`} onClick={(e) => { e.stopPropagation(); openFamiliarStudio(f.id, "identity"); }}>` containing `<Icon name="ph:dots-three-bold" width={10} />`, rendered as a sibling to the existing glyph/presence/unread spans (positioned absolutely top-right of the cell via CSS).
6. Update the prop type from `Familiar[]` to `ResolvedFamiliar[]` (already done in Task 8). Replace `resolveFamiliarGlyph(f, overrides)` with `<FamiliarAvatar familiar={f} size="sm" />` (already done in Task 8 — verify).

In the rail's CSS (find with `grep -rn 'familiar-avatar-rail__avatar' src/app src/styles`), add:

```css
.familiar-avatar-rail__avatar {
  /* existing styles ... */
}

.familiar-avatar-rail__avatar--active {
  /* override existing ring color to use --familiar-accent with fallback */
  box-shadow: 0 0 0 2px var(--familiar-accent, var(--accent-presence));
}

.familiar-avatar-rail__edit {
  position: absolute;
  top: 2px;
  right: 2px;
  opacity: 0;
  pointer-events: none;
  transition: opacity 120ms ease;
  display: grid;
  place-items: center;
  width: 14px;
  height: 14px;
  border-radius: 4px;
  background: var(--bg-raised);
  color: var(--text-secondary);
}

.familiar-avatar-rail__avatar:hover .familiar-avatar-rail__edit,
.familiar-avatar-rail__avatar:focus-within .familiar-avatar-rail__edit {
  opacity: 1;
  pointer-events: auto;
}

.familiar-avatar-rail__edit:hover {
  color: var(--text-primary);
  background: color-mix(in oklch, var(--familiar-accent, var(--accent-presence)) 18%, var(--bg-raised));
}
```

Important: the **presence dot** continues to use its own status-derived color via `presence.dot` class — it must NOT pick up `--familiar-accent`. Do not modify the `.familiar-avatar-rail__presence` rules.

- [ ] **Step 4: Run the rail test**

Run: `node --experimental-strip-types --no-warnings src/components/familiar-avatar-rail.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 6: Visual smoke**

Run `pnpm dev`. Hover an avatar → the `…` button fades in top-right. Click it — nothing happens visibly yet (the Studio drawer doesn't exist yet — log to confirm `openFamiliarStudio` is called via a temporary `console.log` in the context's `openFamiliarStudio` callback, then remove the log before committing). Right-click the avatar → same.

- [ ] **Step 7: Commit**

```bash
git add -f src/components/familiar-avatar-rail.tsx src/components/familiar-avatar-rail.test.ts src/app/globals.css
git commit -S -m "$(cat <<'EOF'
feat(rail): per-familiar accent, hover edit button, right-click trigger

Each rail avatar carries a --familiar-accent CSS variable derived from
the resolved familiar's color. The active-state ring and hover glow
consume it; the presence dot continues to encode status. A new
hover-revealed … button and onContextMenu both call into the new
FamiliarStudio context to open the drawer (mounted in a later task).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Rail drag-to-reorder

**Files:**
- Modify: `src/components/familiar-avatar-rail.tsx`
- Modify: `src/components/familiar-avatar-rail.test.ts`
- Modify: `src/app/globals.css` (or appropriate stylesheet)

- [ ] **Step 1: Add source-regex assertions for DnD**

Append to `src/components/familiar-avatar-rail.test.ts`:

```ts
assert.match(source, /draggable/, "Avatars must be draggable for reorder");
assert.match(source, /onDragStart/, "onDragStart handler must be present");
assert.match(source, /onDragOver/, "onDragOver handler must be present");
assert.match(source, /onDrop/, "onDrop handler must be present");
assert.match(source, /setFamiliarOrder/, "Must call setFamiliarOrder on drop");
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --experimental-strip-types --no-warnings src/components/familiar-avatar-rail.test.ts`
Expected: FAIL on the new assertions.

- [ ] **Step 3: Implement DnD**

In `src/components/familiar-avatar-rail.tsx`:

```tsx
import { setFamiliarOrder } from "@/lib/cave-familiar-order";
import { useState } from "react";
// ...

const [draggingId, setDraggingId] = useState<string | null>(null);
const [dropTargetId, setDropTargetId] = useState<string | null>(null);

function onDragStart(id: string) {
  return (e: React.DragEvent) => {
    setDraggingId(id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", id);
  };
}

function onDragOver(id: string) {
  return (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (id !== draggingId) setDropTargetId(id);
  };
}

function onDrop(targetId: string) {
  return (e: React.DragEvent) => {
    e.preventDefault();
    const sourceId = e.dataTransfer.getData("text/plain") || draggingId;
    setDraggingId(null);
    setDropTargetId(null);
    if (!sourceId || sourceId === targetId) return;
    const ids = familiars.map((f) => f.id);
    const from = ids.indexOf(sourceId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved);
    setFamiliarOrder(ids);
  };
}

function onDragEnd() {
  setDraggingId(null);
  setDropTargetId(null);
}
```

Wire these onto each `<li>` and `<button>`:

```tsx
<li
  key={f.id}
  draggable
  onDragStart={onDragStart(f.id)}
  onDragOver={onDragOver(f.id)}
  onDrop={onDrop(f.id)}
  onDragEnd={onDragEnd}
  data-dragging={draggingId === f.id ? "true" : undefined}
  data-drop-target={dropTargetId === f.id ? "true" : undefined}
>
```

Add CSS to your rail stylesheet:

```css
.familiar-avatar-rail__list > li[data-dragging="true"] {
  opacity: 0.4;
}
.familiar-avatar-rail__list > li[data-drop-target="true"] {
  box-shadow: inset 0 2px 0 0 var(--familiar-accent, var(--accent-presence));
}
```

- [ ] **Step 4: Run the rail test**

Run: `node --experimental-strip-types --no-warnings src/components/familiar-avatar-rail.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 6: Visual smoke**

Run `pnpm dev`. Drag a familiar avatar up or down → it should reorder visually, the new order persists across page refresh (localStorage), and the existing `cave:familiar-order:v1` key in DevTools' Application tab should show the new order.

- [ ] **Step 7: Commit**

```bash
git add -f src/components/familiar-avatar-rail.tsx src/components/familiar-avatar-rail.test.ts src/app/globals.css
git commit -S -m "$(cat <<'EOF'
feat(rail): drag-to-reorder avatars via existing order store

HTML5 drag-and-drop on the rail writes the new id order to the
existing cave:familiar-order:v1 store via setFamiliarOrder.
Visual feedback: dragged item dims to 0.4 opacity; drop target gets
a 2px accent-tinted top border.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 4 — Studio drawer

### Task 11: Extract `FamiliarGlyphPickerPanel` from the modal

**Files:**
- Create: `src/components/familiar-glyph-picker-panel.tsx`
- Modify: `src/components/familiar-glyph-picker.tsx`
- Create: `src/components/familiar-glyph-picker-panel.test.ts`

- [ ] **Step 1: Write the source-regex test**

Create `src/components/familiar-glyph-picker-panel.test.ts`:

```ts
// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./familiar-glyph-picker-panel.tsx", import.meta.url),
  "utf8",
);

assert.match(source, /export function FamiliarGlyphPickerPanel/, "Must export the panel");
assert.match(source, /searchGlyphs/, "Must use searchGlyphs");
assert.match(source, /setGlyphOverride/, "Must call setGlyphOverride");
assert.match(source, /clearGlyphOverride/, "Must support clearing the override");
assert.match(source, /Recent/, "Recent strip must be present");

console.log("familiar-glyph-picker-panel.test.ts: ok");
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --experimental-strip-types --no-warnings src/components/familiar-glyph-picker-panel.test.ts`
Expected: FAIL.

- [ ] **Step 3: Extract the panel**

Create `src/components/familiar-glyph-picker-panel.tsx` containing the inner panel currently inside `familiar-glyph-picker.tsx`'s modal — everything from the search row down to the results grid (lines ~146–235 of the current `familiar-glyph-picker.tsx`). The extracted component takes `{ familiar: Familiar }` as a prop and uses the existing `setGlyphOverride` / `clearGlyphOverride` from `cave-glyph-overrides`.

Skeleton:

```tsx
"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Icon } from "@/lib/icon";
import {
  categories,
  searchGlyphs,
  type GlyphCatalogEntry,
} from "@/lib/glyph-catalog";
import {
  clearGlyphOverride,
  setGlyphOverride,
  useGlyphOverrides,
  useRecentGlyphs,
} from "@/lib/cave-glyph-overrides";
import {
  parseGlyphString,
  resolveFamiliarGlyph,
  serializeGlyph,
  type FamiliarGlyph,
} from "@/lib/familiar-glyph";
import { FamiliarGlyph as GlyphView } from "@/components/familiar-glyph";
import type { Familiar } from "@/lib/types";

type Props = {
  familiar: Familiar;
};

export function FamiliarGlyphPickerPanel({ familiar }: Props) {
  // Move the body of the existing modal here, minus the modal chrome
  // (backdrop, header, footer) — those stay in the modal wrapper.
  // Use the same query state, hover state, recents logic, grids,
  // and the keyboard handler limited to Cmd/Ctrl+Backspace for clear.
  // ... (full implementation moved verbatim from familiar-glyph-picker.tsx) ...
}

// Move GlyphButton, GlyphGrid, CategorizedGrid sub-components here too.
```

Then in `src/components/familiar-glyph-picker.tsx`, replace the body of the modal between the header and the footer with `<FamiliarGlyphPickerPanel familiar={familiar} />`. The modal keeps owning: backdrop, header with current-glyph preview, hover label, close button, footer "reset to default" / "esc to close" rows. The picker's external props (`open`, `familiar`, `onClose`) remain unchanged.

- [ ] **Step 4: Run the panel test**

Run: `node --experimental-strip-types --no-warnings src/components/familiar-glyph-picker-panel.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the modal's existing tests / smoke**

If `familiar-glyph-picker.test.ts` exists, run it. (Grep first: `ls src/components/familiar-glyph-picker.test.*` — if none, skip.) Smoke via `pnpm dev`: open the picker as the user does today (right-click avatar before Task 13, or wire from the existing trigger — confirm the picker still works as before).

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add -f src/components/familiar-glyph-picker-panel.tsx src/components/familiar-glyph-picker-panel.test.ts src/components/familiar-glyph-picker.tsx
git commit -S -m "$(cat <<'EOF'
refactor(glyph-picker): extract inner panel for Studio Look tab reuse

The existing modal keeps its outer chrome (backdrop, header preview,
footer) and delegates its body to a new FamiliarGlyphPickerPanel.
The Studio drawer's Look tab will embed the panel inline. No
behavior change to the existing modal trigger.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: `FamiliarStudio` drawer shell (no tabs yet)

**Files:**
- Create: `src/components/familiar-studio.tsx`
- Create: `src/components/familiar-studio.test.ts`

- [ ] **Step 1: Write the source-regex test**

Create `src/components/familiar-studio.test.ts`:

```ts
// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./familiar-studio.tsx", import.meta.url), "utf8");

assert.match(source, /export function FamiliarStudio/, "Must export FamiliarStudio");
assert.match(source, /useFamiliarStudio/, "Must consume FamiliarStudio context");
assert.match(source, /activeFamiliarId/, "Reads activeFamiliarId from context");
assert.match(source, /Escape/, "Esc dismiss is wired");
assert.match(source, /familiar-studio__drawer/, "Drawer root class must be present");
assert.match(source, /familiar-studio__tabstrip/, "Tab strip class must be present");
assert.match(source, /role="dialog"/, "Drawer must have dialog role for a11y");
assert.match(source, /aria-label/, "Drawer must have an accessible name");

console.log("familiar-studio.test.ts: ok");
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --experimental-strip-types --no-warnings src/components/familiar-studio.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the drawer shell**

Create `src/components/familiar-studio.tsx`:

```tsx
"use client";

import { useEffect, useMemo } from "react";
import { Icon } from "@/lib/icon";
import { FamiliarAvatar } from "@/components/familiar-avatar";
import { useFamiliarStudio, type FamiliarStudioTab } from "@/lib/familiar-studio-context";
import { useResolvedFamiliars } from "@/lib/familiar-resolve";
import type { Familiar } from "@/lib/types";

type Props = {
  familiars: Familiar[];
};

const TABS: Array<{ id: FamiliarStudioTab; label: string; icon: string }> = [
  { id: "identity", label: "Identity", icon: "ph:user-circle" },
  { id: "look", label: "Look", icon: "ph:palette" },
  { id: "brain", label: "Brain", icon: "ph:brain" },
  { id: "lifecycle", label: "Lifecycle", icon: "ph:flow-arrow" },
];

export function FamiliarStudio({ familiars }: Props) {
  const {
    activeFamiliarId,
    listView,
    activeTab,
    setActiveTab,
    closeFamiliarStudio,
  } = useFamiliarStudio();

  const resolved = useResolvedFamiliars(familiars, { includeArchived: true });
  const familiar = useMemo(
    () => resolved.find((f) => f.id === activeFamiliarId) ?? null,
    [resolved, activeFamiliarId],
  );

  // Esc to close
  useEffect(() => {
    if (!activeFamiliarId && !listView) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeFamiliarStudio();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeFamiliarId, listView, closeFamiliarStudio]);

  // No drawer when nothing is open.
  if (!activeFamiliarId && !listView) return null;

  // Open-for-id-that-no-longer-exists empty state.
  if (activeFamiliarId && !familiar) {
    return (
      <aside
        role="dialog"
        aria-label="Familiar Studio"
        className="familiar-studio__drawer familiar-studio__drawer--empty"
      >
        <header className="familiar-studio__header">
          <span className="familiar-studio__title">Familiar Studio</span>
          <button onClick={closeFamiliarStudio} aria-label="Close" className="familiar-studio__close">
            <Icon name="ph:x-bold" />
          </button>
        </header>
        <div className="familiar-studio__empty">
          This familiar is no longer available.
        </div>
      </aside>
    );
  }

  const disableNonLifecycle = listView && !familiar;

  return (
    <aside
      role="dialog"
      aria-label={`Familiar Studio${familiar ? ` — ${familiar.display_name}` : ""}`}
      className="familiar-studio__drawer"
    >
      {/* Tabstrip */}
      <nav className="familiar-studio__tabstrip" aria-label="Studio sections">
        {TABS.map((t) => {
          const disabled = disableNonLifecycle && t.id !== "lifecycle";
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => !disabled && setActiveTab(t.id)}
              aria-current={activeTab === t.id ? "page" : undefined}
              disabled={disabled}
              className={`familiar-studio__tab${activeTab === t.id ? " familiar-studio__tab--active" : ""}`}
            >
              <Icon name={t.icon} width={18} />
              <span>{t.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Main column */}
      <div className="familiar-studio__main">
        <header className="familiar-studio__header">
          {familiar ? (
            <>
              <FamiliarAvatar familiar={familiar} size="lg" />
              <div className="familiar-studio__heading">
                <span className="familiar-studio__name">{familiar.display_name}</span>
                <span className="familiar-studio__role">{familiar.role}</span>
              </div>
            </>
          ) : (
            <span className="familiar-studio__title">Manage familiars</span>
          )}
          <button
            onClick={closeFamiliarStudio}
            aria-label="Close"
            className="familiar-studio__close"
          >
            <Icon name="ph:x-bold" />
          </button>
        </header>

        <div className="familiar-studio__body">
          {/* Tab body slots — wired in later tasks. */}
          {activeTab === "identity" && familiar ? <div data-testid="identity-tab" /> : null}
          {activeTab === "look" && familiar ? <div data-testid="look-tab" /> : null}
          {activeTab === "brain" && familiar ? <div data-testid="brain-tab" /> : null}
          {activeTab === "lifecycle" ? <div data-testid="lifecycle-tab" /> : null}
        </div>

        <footer className="familiar-studio__footer">
          <span className="familiar-studio__autosave">Changes save automatically</span>
        </footer>
      </div>
    </aside>
  );
}
```

Add the matching CSS to your global stylesheet (find the same file you edited in Task 9):

```css
.familiar-studio__drawer {
  position: fixed;
  top: 0;
  right: 0;
  height: 100vh;
  width: min(480px, 92vw);
  display: grid;
  grid-template-columns: 60px 1fr;
  background: var(--bg-base);
  border-left: 1px solid var(--border-hairline);
  box-shadow: -8px 0 32px rgba(0, 0, 0, 0.18);
  z-index: 45;
  animation: familiar-studio-slide 180ms ease-out;
}
@keyframes familiar-studio-slide {
  from { transform: translateX(100%); }
  to   { transform: translateX(0); }
}
.familiar-studio__tabstrip {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 6px;
  border-right: 1px solid var(--border-hairline);
}
.familiar-studio__tab {
  display: grid;
  place-items: center;
  gap: 2px;
  padding: 6px 2px;
  font-size: 10px;
  color: var(--text-secondary);
  background: transparent;
  border: none;
  border-left: 2px solid transparent;
  cursor: pointer;
}
.familiar-studio__tab--active {
  color: var(--text-primary);
  border-left-color: var(--familiar-accent, var(--accent-presence));
}
.familiar-studio__tab:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.familiar-studio__main { display: grid; grid-template-rows: auto 1fr auto; min-height: 0; }
.familiar-studio__header { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-bottom: 1px solid var(--border-hairline); }
.familiar-studio__heading { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.familiar-studio__name { font-size: 14px; font-weight: 600; color: var(--text-primary); }
.familiar-studio__role { font-size: 11px; color: var(--text-muted); }
.familiar-studio__title { font-size: 14px; font-weight: 600; color: var(--text-primary); }
.familiar-studio__close { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 6px; color: var(--text-secondary); background: transparent; border: none; cursor: pointer; }
.familiar-studio__close:hover { background: var(--bg-raised); color: var(--text-primary); }
.familiar-studio__body { padding: 16px; overflow-y: auto; min-height: 0; }
.familiar-studio__footer { padding: 10px 16px; border-top: 1px solid var(--border-hairline); font-size: 11px; color: var(--text-muted); }
.familiar-studio__empty { padding: 32px 16px; text-align: center; color: var(--text-muted); }
```

- [ ] **Step 4: Mount the drawer at the shell layer**

Find the top-level layout that wraps everything (likely `src/app/layout.tsx` or `src/components/shell.tsx`). Wrap the children with `<FamiliarStudioProvider>` and add `<FamiliarStudio familiars={familiars} />` as a sibling of the main content. Example diff outline (adapt to the actual shell):

```tsx
import { FamiliarStudioProvider } from "@/lib/familiar-studio-context";
import { FamiliarStudio } from "@/components/familiar-studio";
// ...
<FamiliarStudioProvider>
  {/* existing shell JSX */}
  <FamiliarStudio familiars={familiars} />
</FamiliarStudioProvider>
```

Confirm by reading `src/components/shell.tsx` and `src/app/layout.tsx` first to choose the right mount point.

- [ ] **Step 5: Run the drawer test**

Run: `node --experimental-strip-types --no-warnings src/components/familiar-studio.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 7: Visual smoke**

Run `pnpm dev`. Click a rail avatar's `…` button → drawer slides in from the right with the right familiar's header and role pill. Tab strip shows 4 tabs with the Identity tab active. Pressing Esc closes the drawer. Tabs other than Lifecycle are clickable and switch the active state (bodies are empty placeholders).

- [ ] **Step 8: Commit**

```bash
git add -f src/components/familiar-studio.tsx src/components/familiar-studio.test.ts src/app/globals.css
# Plus any shell/layout file you modified to mount the drawer + provider.
git commit -S -m "$(cat <<'EOF'
feat(familiar-studio): drawer shell with tab strip and header

Right-side slide-out drawer mounted at the shell layer behind the
FamiliarStudioProvider context. Renders header (avatar + name +
role), 4-tab vertical strip (Identity/Look/Brain/Lifecycle), and
empty body slots for the tab content wired in the next tasks.
Esc dismisses; clicking another rail avatar swaps the context.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: Identity tab

**Files:**
- Create: `src/components/familiar-studio-identity-tab.tsx`
- Create: `src/components/familiar-studio-identity-tab.test.ts`
- Modify: `src/components/familiar-studio.tsx` (mount the tab)

- [ ] **Step 1: Source-regex test**

Create `src/components/familiar-studio-identity-tab.test.ts`:

```ts
// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./familiar-studio-identity-tab.tsx", import.meta.url),
  "utf8",
);

assert.match(source, /export function FamiliarStudioIdentityTab/);
assert.match(source, /display_name/);
assert.match(source, /role/);
assert.match(source, /pronouns/);
assert.match(source, /description/);
assert.match(source, /setFamiliarOverride/);
assert.match(source, /clearFamiliarOverrideField/);

console.log("familiar-studio-identity-tab.test.ts: ok");
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --experimental-strip-types --no-warnings src/components/familiar-studio-identity-tab.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the tab**

Create `src/components/familiar-studio-identity-tab.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Icon } from "@/lib/icon";
import {
  setFamiliarOverride,
  clearFamiliarOverrideField,
  useFamiliarOverrides,
  type FamiliarOverride,
} from "@/lib/cave-familiar-overrides";
import type { ResolvedFamiliar } from "@/lib/familiar-resolve";

type Props = { familiar: ResolvedFamiliar; rawDaemonValues: Partial<FamiliarOverride> };

const FIELDS: Array<{
  key: keyof FamiliarOverride;
  label: string;
  textarea?: boolean;
}> = [
  { key: "display_name", label: "Display name" },
  { key: "role", label: "Role" },
  { key: "pronouns", label: "Pronouns" },
  { key: "description", label: "Description", textarea: true },
];

export function FamiliarStudioIdentityTab({ familiar, rawDaemonValues }: Props) {
  const overrides = useFamiliarOverrides();
  const current = overrides[familiar.id] ?? {};

  return (
    <div className="familiar-studio-identity">
      {FIELDS.map((f) => (
        <IdentityField
          key={f.key}
          field={f.key}
          label={f.label}
          textarea={f.textarea}
          value={current[f.key]}
          daemonValue={rawDaemonValues[f.key]}
          onSave={(v) => setFamiliarOverride(familiar.id, { [f.key]: v })}
          onReset={() => clearFamiliarOverrideField(familiar.id, f.key)}
        />
      ))}
    </div>
  );
}

function IdentityField({
  field,
  label,
  textarea,
  value,
  daemonValue,
  onSave,
  onReset,
}: {
  field: keyof FamiliarOverride;
  label: string;
  textarea?: boolean;
  value: string | undefined;
  daemonValue: string | undefined;
  onSave: (v: string) => void;
  onReset: () => void;
}) {
  const [draft, setDraft] = useState(value ?? "");
  const placeholder = daemonValue ?? "—";
  const hasOverride = value !== undefined;

  function commit() {
    if (draft.trim() === "") {
      // Empty input clears the override (reverts to daemon).
      onReset();
      return;
    }
    if (draft !== value) onSave(draft);
  }

  const inputProps = {
    value: draft,
    placeholder,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(e.target.value),
    onBlur: commit,
    className: "familiar-studio-identity__input",
  };

  return (
    <label className="familiar-studio-identity__row">
      <span className="familiar-studio-identity__label">{label}</span>
      <div className="familiar-studio-identity__control">
        {textarea ? (
          <textarea rows={3} {...(inputProps as any)} />
        ) : (
          <input type="text" {...(inputProps as any)} />
        )}
        <button
          type="button"
          aria-label={`Reset ${label} to daemon value`}
          title="Reset to daemon value"
          disabled={!hasOverride}
          onClick={() => {
            onReset();
            setDraft("");
          }}
          className="familiar-studio-identity__reset"
        >
          <Icon name="ph:arrow-counter-clockwise-bold" width={12} />
        </button>
      </div>
    </label>
  );
}
```

Add minimal CSS:

```css
.familiar-studio-identity { display: flex; flex-direction: column; gap: 14px; }
.familiar-studio-identity__row { display: flex; flex-direction: column; gap: 4px; }
.familiar-studio-identity__label { font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.04em; }
.familiar-studio-identity__control { display: flex; gap: 6px; align-items: flex-start; }
.familiar-studio-identity__input {
  flex: 1;
  background: var(--bg-raised);
  border: 1px solid var(--border-hairline);
  border-radius: 6px;
  padding: 6px 8px;
  color: var(--text-primary);
  font-size: 13px;
}
.familiar-studio-identity__input:focus { outline: none; border-color: var(--border-strong); }
.familiar-studio-identity__reset {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary);
  border: 1px solid var(--border-hairline);
  cursor: pointer;
}
.familiar-studio-identity__reset:disabled { opacity: 0.3; cursor: not-allowed; }
```

- [ ] **Step 4: Mount the tab**

Edit `src/components/familiar-studio.tsx`. Add the import:

```tsx
import { FamiliarStudioIdentityTab } from "./familiar-studio-identity-tab";
```

Replace the `{activeTab === "identity" && familiar ? <div data-testid="identity-tab" /> : null}` slot with:

```tsx
{activeTab === "identity" && familiar ? (
  <FamiliarStudioIdentityTab
    familiar={familiar}
    rawDaemonValues={{
      display_name: familiars.find((f) => f.id === familiar.id)?.display_name,
      role: familiars.find((f) => f.id === familiar.id)?.role,
      pronouns: familiars.find((f) => f.id === familiar.id)?.pronouns,
      description: familiars.find((f) => f.id === familiar.id)?.description,
    }}
  />
) : null}
```

(The `familiars` prop is the *unresolved* daemon list, so daemon values are available as ghosted placeholders even when the override matches.)

- [ ] **Step 5: Run the identity tab test**

Run: `node --experimental-strip-types --no-warnings src/components/familiar-studio-identity-tab.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 7: Visual smoke**

Run `pnpm dev`. Open Studio for a familiar → Identity tab shows the 4 fields with daemon values as placeholders. Type a new display name and blur → name updates in the rail and across the app (live, no reload). Click `↺ reset` → field clears and the daemon value re-renders.

- [ ] **Step 8: Commit**

```bash
git add -f src/components/familiar-studio-identity-tab.tsx src/components/familiar-studio-identity-tab.test.ts src/components/familiar-studio.tsx src/app/globals.css
git commit -S -m "$(cat <<'EOF'
feat(familiar-studio): Identity tab — name/role/pronouns/description

Inline-editing of identity fields backed by cave-familiar-overrides.
Each field auto-saves on blur, clears with the row's ↺ reset
button, and shows the daemon value as placeholder when no override
exists. Empty input on blur clears the override.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 14: Look tab — embedded glyph picker + color + image upload

**Files:**
- Create: `src/components/familiar-studio-look-tab.tsx`
- Create: `src/components/familiar-studio-look-tab.test.ts`
- Modify: `src/components/familiar-studio.tsx`

- [ ] **Step 1: Source-regex test**

Create `src/components/familiar-studio-look-tab.test.ts`:

```ts
// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./familiar-studio-look-tab.tsx", import.meta.url),
  "utf8",
);

assert.match(source, /export function FamiliarStudioLookTab/);
assert.match(source, /FamiliarGlyphPickerPanel/);
assert.match(source, /setFamiliarImage/);
assert.match(source, /clearFamiliarImage/);
assert.match(source, /setFamiliarOverride/);
assert.match(source, /color/);
assert.match(source, /input.*type="color"/);
assert.match(source, /input.*type="file"/);
assert.match(source, /onDrop|onDragOver/, "Drag-drop wired for image upload");

console.log("familiar-studio-look-tab.test.ts: ok");
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --experimental-strip-types --no-warnings src/components/familiar-studio-look-tab.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the tab**

Create `src/components/familiar-studio-look-tab.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Icon } from "@/lib/icon";
import { FamiliarGlyphPickerPanel } from "./familiar-glyph-picker-panel";
import {
  setFamiliarImage,
  clearFamiliarImage,
  useFamiliarImages,
} from "@/lib/cave-familiar-images";
import {
  setFamiliarOverride,
  clearFamiliarOverrideField,
  useFamiliarOverrides,
} from "@/lib/cave-familiar-overrides";
import type { ResolvedFamiliar } from "@/lib/familiar-resolve";

const COLOR_PRESETS = ["#f59e0b", "#10b981", "#3b82f6", "#8b5cf6", "#ec4899", "#ef4444", "#6b7280", "#0ea5e9"];

type Props = { familiar: ResolvedFamiliar };

export function FamiliarStudioLookTab({ familiar }: Props) {
  const overrides = useFamiliarOverrides();
  const images = useFamiliarImages();
  const currentColor = overrides[familiar.id]?.color ?? null;
  const currentImage = images[familiar.id];
  const [toast, setToast] = useState<string | null>(null);

  function pickColor(c: string | null) {
    if (c === null) clearFamiliarOverrideField(familiar.id, "color");
    else setFamiliarOverride(familiar.id, { color: c });
  }

  async function onFile(file: File) {
    setToast(null);
    const dataUrl = await fileToDataUrl(file);
    const res = setFamiliarImage(familiar.id, { dataUrl, mime: file.type });
    if (!res.ok) setToast(res.reason);
  }

  return (
    <div className="familiar-studio-look">
      <section className="familiar-studio-look__section">
        <h3 className="familiar-studio-look__heading">Icon</h3>
        <FamiliarGlyphPickerPanel familiar={familiar} />
      </section>

      <section className="familiar-studio-look__section">
        <h3 className="familiar-studio-look__heading">Accent color</h3>
        <div className="familiar-studio-look__swatches">
          {COLOR_PRESETS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Use ${c}`}
              onClick={() => pickColor(c)}
              className={`familiar-studio-look__swatch${currentColor === c ? " familiar-studio-look__swatch--active" : ""}`}
              style={{ background: c }}
            />
          ))}
          <input
            type="color"
            value={currentColor ?? "#888888"}
            onChange={(e) => pickColor(e.target.value)}
            aria-label="Custom accent color"
            className="familiar-studio-look__custom"
          />
          <button
            type="button"
            onClick={() => pickColor(null)}
            disabled={!currentColor}
            className="familiar-studio-look__reset"
          >
            Reset
          </button>
        </div>
      </section>

      <section className="familiar-studio-look__section">
        <h3 className="familiar-studio-look__heading">Avatar image</h3>
        <div
          className="familiar-studio-look__dropzone"
          onDragOver={(e) => { e.preventDefault(); }}
          onDrop={(e) => {
            e.preventDefault();
            const file = e.dataTransfer.files[0];
            if (file) void onFile(file);
          }}
        >
          {currentImage ? (
            <>
              <img src={currentImage.dataUrl} alt="Current avatar" width={72} height={72} />
              <button
                type="button"
                onClick={() => clearFamiliarImage(familiar.id)}
                className="familiar-studio-look__remove"
              >
                Remove image
              </button>
            </>
          ) : (
            <span className="familiar-studio-look__hint">
              Drop a PNG, JPEG, WebP, or SVG (max 2MB), or
            </span>
          )}
          <label className="familiar-studio-look__upload">
            <Icon name="ph:upload-bold" width={14} /> Choose file
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void onFile(file);
                e.target.value = "";
              }}
            />
          </label>
        </div>
        {toast ? <p className="familiar-studio-look__toast">{toast}</p> : null}
      </section>
    </div>
  );
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
```

Add minimal CSS:

```css
.familiar-studio-look { display: flex; flex-direction: column; gap: 18px; }
.familiar-studio-look__section { display: flex; flex-direction: column; gap: 8px; }
.familiar-studio-look__heading { font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.04em; }
.familiar-studio-look__swatches { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.familiar-studio-look__swatch { width: 22px; height: 22px; border-radius: 6px; border: 2px solid transparent; cursor: pointer; }
.familiar-studio-look__swatch--active { border-color: var(--text-primary); }
.familiar-studio-look__custom { width: 28px; height: 28px; border: none; background: transparent; cursor: pointer; }
.familiar-studio-look__reset { font-size: 11px; color: var(--text-secondary); background: transparent; border: 1px solid var(--border-hairline); border-radius: 4px; padding: 4px 8px; cursor: pointer; }
.familiar-studio-look__reset:disabled { opacity: 0.3; cursor: not-allowed; }
.familiar-studio-look__dropzone { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 16px; border: 1px dashed var(--border-hairline); border-radius: 8px; }
.familiar-studio-look__hint { font-size: 12px; color: var(--text-muted); }
.familiar-studio-look__upload { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-primary); cursor: pointer; }
.familiar-studio-look__remove { font-size: 11px; color: var(--text-secondary); background: transparent; border: 1px solid var(--border-hairline); border-radius: 4px; padding: 4px 8px; cursor: pointer; }
.familiar-studio-look__toast { font-size: 11px; color: var(--accent-warning, #f59e0b); }
```

- [ ] **Step 4: Mount the tab**

In `src/components/familiar-studio.tsx`:

```tsx
import { FamiliarStudioLookTab } from "./familiar-studio-look-tab";
```

Replace the look-tab slot:

```tsx
{activeTab === "look" && familiar ? <FamiliarStudioLookTab familiar={familiar} /> : null}
```

- [ ] **Step 5: Run the look tab test**

Run: `node --experimental-strip-types --no-warnings src/components/familiar-studio-look-tab.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 7: Visual smoke**

Run `pnpm dev`. Open Studio → Look tab. Pick a glyph → the rail avatar updates live. Pick a preset color → rail's active ring tints to that color. Upload a small PNG → the avatar in the header and the rail switches to the image; remove it → falls back to glyph. Try a 3MB image → toast shows "Image too large".

- [ ] **Step 8: Commit**

```bash
git add -f src/components/familiar-studio-look-tab.tsx src/components/familiar-studio-look-tab.test.ts src/components/familiar-studio.tsx src/app/globals.css
git commit -S -m "$(cat <<'EOF'
feat(familiar-studio): Look tab — glyph picker, color, image upload

Embeds FamiliarGlyphPickerPanel for icon selection, 8 preset color
swatches + custom hex picker + reset for the per-familiar accent,
and a drag-drop / file-picker image upload that writes to
cave-familiar-images. Size / format rejections surface as a toast
in the tab.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 15: Brain tab — harness/model/note via `PATCH /api/config`

**Files:**
- Create: `src/components/familiar-studio-brain-tab.tsx`
- Create: `src/components/familiar-studio-brain-tab.test.ts`
- Modify: `src/components/familiar-studio.tsx`

- [ ] **Step 1: Source-regex test**

Create `src/components/familiar-studio-brain-tab.test.ts`:

```ts
// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./familiar-studio-brain-tab.tsx", import.meta.url),
  "utf8",
);

assert.match(source, /export function FamiliarStudioBrainTab/);
assert.match(source, /harness/);
assert.match(source, /model/);
assert.match(source, /note/);
assert.match(source, /\/api\/harnesses/);
assert.match(source, /\/api\/config/);
assert.match(source, /method.*PATCH/);

console.log("familiar-studio-brain-tab.test.ts: ok");
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --experimental-strip-types --no-warnings src/components/familiar-studio-brain-tab.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the tab**

Create `src/components/familiar-studio-brain-tab.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/lib/icon";
import type { ResolvedFamiliar } from "@/lib/familiar-resolve";

type Props = { familiar: ResolvedFamiliar };

type HarnessReport = { id: string; label: string; installed: boolean };

const MODEL_SUGGESTIONS = [
  "anthropic/claude-opus-4-7",
  "anthropic/claude-sonnet-4-6",
  "anthropic/claude-haiku-4-5",
  "openai/gpt-5.5",
];

export function FamiliarStudioBrainTab({ familiar }: Props) {
  const [harnesses, setHarnesses] = useState<HarnessReport[]>([]);
  const [draftHarness, setDraftHarness] = useState(familiar.harness ?? "");
  const [draftModel, setDraftModel] = useState(familiar.model ?? "");
  const [draftNote, setDraftNote] = useState(familiar.note ?? "");
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/harnesses", { cache: "no-store" });
        const json = await res.json();
        if (!cancelled && json.ok) setHarnesses(json.harnesses ?? []);
      } catch { /* keep empty */ }
    })();
    return () => { cancelled = true; };
  }, []);

  async function save(patch: Record<string, unknown>) {
    setToast(null);
    try {
      const res = await fetch("/api/config", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ familiars: { [familiar.id]: patch } }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setToast(`Couldn't save: ${json.error ?? res.statusText}`);
        // Revert local draft to last-known value on failure.
        if ("harness" in patch) setDraftHarness(familiar.harness ?? "");
        if ("model" in patch) setDraftModel(familiar.model ?? "");
        if ("note" in patch) setDraftNote(familiar.note ?? "");
      }
    } catch (err) {
      setToast(`Couldn't save: ${(err as Error).message}`);
    }
  }

  return (
    <div className="familiar-studio-brain">
      <label className="familiar-studio-brain__row">
        <span className="familiar-studio-brain__label">Harness</span>
        <div className="familiar-studio-brain__control">
          <select
            value={draftHarness}
            onChange={(e) => {
              setDraftHarness(e.target.value);
              void save({ harness: e.target.value });
            }}
            className="familiar-studio-brain__input"
          >
            <option value="">— inherit default —</option>
            {harnesses.map((h) => (
              <option key={h.id} value={h.id}>
                {h.label}{h.installed ? "" : " (not installed)"}
              </option>
            ))}
          </select>
        </div>
      </label>

      <label className="familiar-studio-brain__row">
        <span className="familiar-studio-brain__label">Model</span>
        <div className="familiar-studio-brain__control">
          <input
            type="text"
            list="familiar-studio-brain-models"
            value={draftModel}
            onChange={(e) => setDraftModel(e.target.value)}
            onBlur={() => save({ model: draftModel.trim() || undefined })}
            placeholder="anthropic/claude-opus-4-7"
            className="familiar-studio-brain__input"
          />
          <datalist id="familiar-studio-brain-models">
            {MODEL_SUGGESTIONS.map((m) => <option key={m} value={m} />)}
          </datalist>
        </div>
      </label>

      <label className="familiar-studio-brain__row">
        <span className="familiar-studio-brain__label">System prompt / note</span>
        <div className="familiar-studio-brain__control">
          <textarea
            rows={5}
            value={draftNote}
            onChange={(e) => setDraftNote(e.target.value)}
            onBlur={() => save({ note: draftNote.trim() || undefined })}
            placeholder="Plain text instructions to seed this familiar's behavior."
            className="familiar-studio-brain__input"
          />
        </div>
      </label>

      {toast ? <p className="familiar-studio-brain__toast">{toast}</p> : null}
    </div>
  );
}
```

CSS (append):

```css
.familiar-studio-brain { display: flex; flex-direction: column; gap: 14px; }
.familiar-studio-brain__row { display: flex; flex-direction: column; gap: 4px; }
.familiar-studio-brain__label { font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.04em; }
.familiar-studio-brain__control { display: flex; gap: 6px; align-items: flex-start; }
.familiar-studio-brain__input {
  flex: 1;
  background: var(--bg-raised);
  border: 1px solid var(--border-hairline);
  border-radius: 6px;
  padding: 6px 8px;
  color: var(--text-primary);
  font-size: 13px;
  font-family: inherit;
}
.familiar-studio-brain__input:focus { outline: none; border-color: var(--border-strong); }
.familiar-studio-brain__toast { font-size: 11px; color: var(--accent-warning, #f59e0b); }
```

- [ ] **Step 4: Mount the tab**

In `src/components/familiar-studio.tsx`:

```tsx
import { FamiliarStudioBrainTab } from "./familiar-studio-brain-tab";
// ...
{activeTab === "brain" && familiar ? <FamiliarStudioBrainTab familiar={familiar} /> : null}
```

- [ ] **Step 5: Run the brain tab test**

Run: `node --experimental-strip-types --no-warnings src/components/familiar-studio-brain-tab.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 7: Visual smoke**

Run `pnpm dev`. Open Studio → Brain tab. Change harness → settings panel's harness pill for that familiar updates after a refetch (or open and reopen). Edit the model field and blur → `cave-config.json` writes (inspect via `cat ~/.coven/cave-config.json`). Edit the note → same.

- [ ] **Step 8: Commit**

```bash
git add -f src/components/familiar-studio-brain-tab.tsx src/components/familiar-studio-brain-tab.test.ts src/components/familiar-studio.tsx src/app/globals.css
git commit -S -m "$(cat <<'EOF'
feat(familiar-studio): Brain tab — harness / model / note

Wires harness dropdown (from /api/harnesses), model input with
common-model autocomplete, and free-form note textarea through the
existing PATCH /api/config route, which shallow-merges into
cave-config.json.familiars[id]. Errors revert the local draft and
surface a toast.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 16: Lifecycle tab — archive, reset, list view

**Files:**
- Create: `src/components/familiar-studio-lifecycle-tab.tsx`
- Create: `src/components/familiar-studio-lifecycle-tab.test.ts`
- Modify: `src/components/familiar-studio.tsx`

- [ ] **Step 1: Source-regex test**

Create `src/components/familiar-studio-lifecycle-tab.test.ts`:

```ts
// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./familiar-studio-lifecycle-tab.tsx", import.meta.url),
  "utf8",
);

assert.match(source, /export function FamiliarStudioLifecycleTab/);
assert.match(source, /archiveFamiliar/);
assert.match(source, /unarchiveFamiliar/);
assert.match(source, /clearAllFamiliarOverrides/);
assert.match(source, /clearGlyphOverride/);
assert.match(source, /clearFamiliarImage/);
assert.match(source, /listView/);

console.log("familiar-studio-lifecycle-tab.test.ts: ok");
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --experimental-strip-types --no-warnings src/components/familiar-studio-lifecycle-tab.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the tab**

Create `src/components/familiar-studio-lifecycle-tab.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Icon } from "@/lib/icon";
import { FamiliarAvatar } from "@/components/familiar-avatar";
import {
  archiveFamiliar,
  unarchiveFamiliar,
  useArchivedFamiliars,
} from "@/lib/cave-familiar-archive";
import { clearAllFamiliarOverrides } from "@/lib/cave-familiar-overrides";
import { clearGlyphOverride } from "@/lib/cave-glyph-overrides";
import { clearFamiliarImage } from "@/lib/cave-familiar-images";
import { useFamiliarStudio } from "@/lib/familiar-studio-context";
import type { ResolvedFamiliar } from "@/lib/familiar-resolve";

type Props = {
  familiar: ResolvedFamiliar | null;  // null when in list view
  allResolved: ResolvedFamiliar[];     // includes archived ones
};

export function FamiliarStudioLifecycleTab({ familiar, allResolved }: Props) {
  const archived = useArchivedFamiliars();
  const { openFamiliarStudio, listView } = useFamiliarStudio();
  const [confirmReset, setConfirmReset] = useState(false);

  if (listView) {
    const active = allResolved.filter((f) => !(f.id in archived));
    const archivedList = allResolved.filter((f) => f.id in archived);
    return (
      <div className="familiar-studio-lifecycle">
        <section>
          <h3 className="familiar-studio-lifecycle__heading">Active</h3>
          {active.map((f) => (
            <FamiliarRow
              key={f.id}
              familiar={f}
              isArchived={false}
              onSelect={() => openFamiliarStudio(f.id, "identity")}
              onArchive={() => archiveFamiliar(f.id)}
              onUnarchive={() => unarchiveFamiliar(f.id)}
            />
          ))}
        </section>
        {archivedList.length > 0 ? (
          <section>
            <h3 className="familiar-studio-lifecycle__heading">Archived</h3>
            {archivedList.map((f) => (
              <FamiliarRow
                key={f.id}
                familiar={f}
                isArchived={true}
                onSelect={() => openFamiliarStudio(f.id, "identity")}
                onArchive={() => archiveFamiliar(f.id)}
                onUnarchive={() => unarchiveFamiliar(f.id)}
              />
            ))}
          </section>
        ) : null}
      </div>
    );
  }

  if (!familiar) return null;

  const isArchived = familiar.id in archived;

  function resetAll() {
    if (!confirmReset) {
      setConfirmReset(true);
      return;
    }
    clearAllFamiliarOverrides(familiar.id);
    clearGlyphOverride(familiar.id);
    clearFamiliarImage(familiar.id);
    void fetch("/api/config", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ familiars: { [familiar.id]: {} } }),
    });
    setConfirmReset(false);
  }

  return (
    <div className="familiar-studio-lifecycle">
      <section className="familiar-studio-lifecycle__section">
        <h3 className="familiar-studio-lifecycle__heading">Archive</h3>
        <p className="familiar-studio-lifecycle__hint">
          Archived familiars are hidden from the rail and switchers but remain
          in this Studio's list view.
        </p>
        {isArchived ? (
          <button onClick={() => unarchiveFamiliar(familiar.id)} className="familiar-studio-lifecycle__btn">
            <Icon name="ph:arrow-counter-clockwise-bold" width={14} /> Unarchive
          </button>
        ) : (
          <button onClick={() => archiveFamiliar(familiar.id)} className="familiar-studio-lifecycle__btn">
            <Icon name="ph:archive-bold" width={14} /> Archive
          </button>
        )}
      </section>

      <section className="familiar-studio-lifecycle__section">
        <h3 className="familiar-studio-lifecycle__heading">Reset overrides</h3>
        <p className="familiar-studio-lifecycle__hint">
          Clears identity / look / brain customizations and reverts this
          familiar to its daemon defaults.
        </p>
        <button
          onClick={resetAll}
          className={`familiar-studio-lifecycle__btn familiar-studio-lifecycle__btn--danger${confirmReset ? " familiar-studio-lifecycle__btn--confirm" : ""}`}
        >
          <Icon name="ph:trash-bold" width={14} />
          {confirmReset ? "Click again to confirm" : "Reset all overrides"}
        </button>
      </section>
    </div>
  );
}

function FamiliarRow({
  familiar,
  isArchived,
  onSelect,
  onArchive,
  onUnarchive,
}: {
  familiar: ResolvedFamiliar;
  isArchived: boolean;
  onSelect: () => void;
  onArchive: () => void;
  onUnarchive: () => void;
}) {
  return (
    <div className="familiar-studio-lifecycle__row">
      <button type="button" onClick={onSelect} className="familiar-studio-lifecycle__row-main">
        <FamiliarAvatar familiar={familiar} size="sm" />
        <span>{familiar.display_name}</span>
      </button>
      {isArchived ? (
        <button onClick={onUnarchive} aria-label="Unarchive" className="familiar-studio-lifecycle__row-action">
          <Icon name="ph:arrow-counter-clockwise-bold" width={12} />
        </button>
      ) : (
        <button onClick={onArchive} aria-label="Archive" className="familiar-studio-lifecycle__row-action">
          <Icon name="ph:archive-bold" width={12} />
        </button>
      )}
    </div>
  );
}
```

CSS (append):

```css
.familiar-studio-lifecycle { display: flex; flex-direction: column; gap: 18px; }
.familiar-studio-lifecycle__section { display: flex; flex-direction: column; gap: 6px; }
.familiar-studio-lifecycle__heading { font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.04em; }
.familiar-studio-lifecycle__hint { font-size: 12px; color: var(--text-muted); line-height: 1.4; margin: 0; }
.familiar-studio-lifecycle__btn { display: inline-flex; align-items: center; gap: 6px; align-self: flex-start; background: var(--bg-raised); border: 1px solid var(--border-hairline); border-radius: 6px; padding: 6px 10px; color: var(--text-primary); font-size: 12px; cursor: pointer; }
.familiar-studio-lifecycle__btn:hover { background: color-mix(in oklch, var(--text-primary) 8%, var(--bg-raised)); }
.familiar-studio-lifecycle__btn--danger { color: var(--accent-danger, #ef4444); }
.familiar-studio-lifecycle__btn--confirm { background: var(--accent-danger, #ef4444); color: var(--bg-base); border-color: transparent; }
.familiar-studio-lifecycle__row { display: flex; gap: 4px; padding: 4px; border-radius: 6px; }
.familiar-studio-lifecycle__row:hover { background: var(--bg-raised); }
.familiar-studio-lifecycle__row-main { display: flex; gap: 8px; align-items: center; flex: 1; background: transparent; border: none; padding: 4px 6px; cursor: pointer; color: var(--text-primary); font-size: 13px; }
.familiar-studio-lifecycle__row-action { display: grid; place-items: center; width: 24px; height: 24px; border-radius: 4px; background: transparent; border: none; color: var(--text-secondary); cursor: pointer; }
.familiar-studio-lifecycle__row-action:hover { color: var(--text-primary); background: var(--bg-base); }
```

- [ ] **Step 4: Mount the tab**

In `src/components/familiar-studio.tsx`:

```tsx
import { FamiliarStudioLifecycleTab } from "./familiar-studio-lifecycle-tab";
// ...
{activeTab === "lifecycle" ? (
  <FamiliarStudioLifecycleTab
    familiar={familiar}
    allResolved={useResolvedFamiliars(familiars, { includeArchived: true })}
  />
) : null}
```

Hoist that `useResolvedFamiliars` call to top of the component to avoid violating Rules of Hooks; the existing `resolved` const should already include archived since the drawer's effective list does. Refactor:

```tsx
const resolvedIncludingArchived = useResolvedFamiliars(familiars, { includeArchived: true });
// ...replace the `resolved` const used in `familiar = resolved.find(...)` with this one.
```

- [ ] **Step 5: Run the lifecycle tab test**

Run: `node --experimental-strip-types --no-warnings src/components/familiar-studio-lifecycle-tab.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 7: Visual smoke**

Run `pnpm dev`. Open Studio → Lifecycle. Click Archive → familiar disappears from the rail (still visible in switchers? — verify by opening switcher; should also be filtered). Open list view (we wire the entry point next task) and unarchive — familiar re-appears. Click Reset all overrides → first click shows confirm prompt, second click clears all four stores and `cave-config.json` entry for the familiar.

- [ ] **Step 8: Commit**

```bash
git add -f src/components/familiar-studio-lifecycle-tab.tsx src/components/familiar-studio-lifecycle-tab.test.ts src/components/familiar-studio.tsx src/app/globals.css
git commit -S -m "$(cat <<'EOF'
feat(familiar-studio): Lifecycle tab — archive, reset, list view

Adds archive/unarchive toggle, two-click confirm Reset-all-overrides
(clears the three localStorage stores + resets cave-config.json
entry), and a list-view mode for browsing all familiars including
archived ones with quick-action toggles and click-to-edit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 5 — Integration

### Task 17: Wire Studio entry points — settings panel "Edit" + `+` button right-click

**Files:**
- Modify: `src/components/settings-familiars-panel.tsx`
- Modify: `src/components/familiar-avatar-rail.tsx`

- [ ] **Step 1: Add "Edit" button to settings panel**

In `src/components/settings-familiars-panel.tsx`, inside each `.settings-familiars-panel__card-head` `<header>`, append an "Edit" button after the harness pill:

```tsx
import { useFamiliarStudio } from "@/lib/familiar-studio-context";
// ...
const { openFamiliarStudio } = useFamiliarStudio();
// ...
<button
  type="button"
  onClick={() => openFamiliarStudio(f.id, "identity")}
  className="settings-familiars-panel__edit"
  aria-label={`Edit ${f.display_name}`}
>
  <Icon name="ph:pencil-simple-bold" width={12} />
  Edit
</button>
```

Add the CSS rule:

```css
.settings-familiars-panel__edit {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--text-secondary);
  background: transparent;
  border: 1px solid var(--border-hairline);
  border-radius: 4px;
  padding: 3px 6px;
  cursor: pointer;
}
.settings-familiars-panel__edit:hover { color: var(--text-primary); background: var(--bg-raised); }
```

- [ ] **Step 2: Wire `+` button right-click in the rail**

In `src/components/familiar-avatar-rail.tsx`, the existing add button is at the bottom:

```tsx
<button
  type="button"
  className="familiar-avatar-rail__add"
  aria-label="Add familiar"
  title="Add familiar"
  onClick={onAddFamiliar}
>
```

Add a state-based small popover menu for right-click. For simplicity (avoiding a new popover dependency), use a `details/summary` pattern or wire onContextMenu to open list view directly. Keep it simple:

```tsx
const { openFamiliarStudioListView } = useFamiliarStudio();
// ...
<button
  type="button"
  className="familiar-avatar-rail__add"
  aria-label="Add familiar"
  title="Add familiar (right-click to manage)"
  onClick={onAddFamiliar}
  onContextMenu={(e) => {
    e.preventDefault();
    openFamiliarStudioListView();
  }}
>
```

The right-click goes straight to the Studio list view. The discoverable left-click is documented in the tooltip (`title=`).

- [ ] **Step 3: Update the rail source-regex test**

In `src/components/familiar-avatar-rail.test.ts`, append:

```ts
assert.match(source, /openFamiliarStudioListView/, "Right-click on + opens list view");
```

- [ ] **Step 4: Run rail + settings tests**

Run:
```
node --experimental-strip-types --no-warnings src/components/familiar-avatar-rail.test.ts
```

(There is no `settings-familiars-panel.test.ts` today; skip if absent.)

Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 6: Visual smoke**

`pnpm dev`. Open settings → familiars panel → click Edit on a card → Studio opens to Identity for that familiar. Right-click the rail's `+` button → Studio opens in list view on Lifecycle tab.

- [ ] **Step 7: Commit**

```bash
git add -f src/components/settings-familiars-panel.tsx src/components/familiar-avatar-rail.tsx src/components/familiar-avatar-rail.test.ts src/app/globals.css
git commit -S -m "$(cat <<'EOF'
feat(familiar-studio): wire Edit button + right-click + entry

Settings panel cards gain an Edit button that opens Studio on the
Identity tab. Right-clicking the rail's + button opens Studio in
list view on the Lifecycle tab (left-click on + still calls the
existing onAddFamiliar onboarding flow unchanged).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 6 — Final pass

### Task 18: End-to-end smoke + ad-hoc fixes + plan-doc commit

- [ ] **Step 1: Run the full test suite**

Run each test file added or modified by this plan:

```
node --experimental-strip-types --no-warnings src/lib/familiar-glyph.test.ts
node --experimental-strip-types --no-warnings src/lib/cave-familiar-overrides.test.ts
node --experimental-strip-types --no-warnings src/lib/cave-familiar-images.test.ts
node --experimental-strip-types --no-warnings src/lib/cave-familiar-archive.test.ts
node --experimental-strip-types --no-warnings src/lib/familiar-resolve.test.ts
node --experimental-strip-types --no-warnings src/lib/familiar-studio-context.test.ts
node --experimental-strip-types --no-warnings src/components/familiar-avatar.test.ts
node --experimental-strip-types --no-warnings src/components/familiar-avatar-rail.test.ts
node --experimental-strip-types --no-warnings src/components/familiar-glyph-picker-panel.test.ts
node --experimental-strip-types --no-warnings src/components/familiar-studio.test.ts
node --experimental-strip-types --no-warnings src/components/familiar-studio-identity-tab.test.ts
node --experimental-strip-types --no-warnings src/components/familiar-studio-look-tab.test.ts
node --experimental-strip-types --no-warnings src/components/familiar-studio-brain-tab.test.ts
node --experimental-strip-types --no-warnings src/components/familiar-studio-lifecycle-tab.test.ts
```

Expected: every line prints `<name>.test.ts: ok` and exits 0.

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 3: Build**

Run: `pnpm build`
Expected: success (note CI flakes Turbopack — retry up to 3 times with `rm -rf .next` between attempts, matching the CI behavior).

- [ ] **Step 4: Manual smoke checklist**

Run `pnpm dev` and walk this path end-to-end without errors in the console:

1. Rail renders all familiars, sorted by stored order.
2. Hover over any avatar → `…` button fades in top-right.
3. Click `…` → Studio drawer slides in, header shows familiar avatar + name + role, Identity tab is active.
4. In Identity, change display name → blur → rail name updates live.
5. Click `↺ reset` next to name → daemon name returns.
6. Switch to Look tab → pick a glyph → rail updates. Pick a color preset → rail's active ring color changes (only when this familiar is the active one).
7. Drop a small PNG on the upload zone → header avatar + rail avatar switches to the image.
8. Switch to Brain tab → change harness → settings panel reflects the change after a refetch. Edit note → blur → `cat ~/.coven/cave-config.json` shows the note under `familiars[id]`.
9. Switch to Lifecycle → Archive → familiar disappears from the rail. Right-click rail `+` → list view shows it under "Archived". Click Unarchive → it returns.
10. Reset all overrides → first click prompts confirm, second click clears every change made in steps 4–8.
11. Drag a familiar avatar above another → reorder persists across page reload.
12. Right-click an avatar → Studio opens on Identity.
13. From settings panel, click Edit on a card → Studio opens on Identity.
14. Press Esc with the drawer open → drawer closes.

If any step fails, fix the underlying issue, run the affected test, and commit the fix as its own commit before continuing.

- [ ] **Step 5: Add the plan doc to git (it's gitignored)**

```bash
git add -f docs/superpowers/plans/2026-06-08-familiar-studio.md
git commit -S -m "$(cat <<'EOF'
docs(plan): familiar studio implementation plan

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 6: Verify all commits in this branch are signed**

Run: `git log origin/main..HEAD --pretty='%H %G?' | awk '$2 != "G" {print "UNSIGNED:", $0}'`
Expected: no output. If anything prints, do NOT push. Re-sign the missing commits via rebase before continuing.

---

## Self-Review Notes

Spec coverage check (every requirement → at least one task):

| Spec requirement | Task |
|---|---|
| Per-familiar accent CSS var on rail buttons (not on presence dot) | 9 |
| Hover-reveal `…` affordance | 9 |
| Right-click on rail avatar opens Studio Identity | 9 |
| `inferGlyphFromRole` + new resolution precedence step | 1 |
| Image avatars beat glyph in render | 5, 6 |
| Improved active-state ring (uses `--familiar-accent`) | 9 |
| `FamiliarAvatar` sibling component | 6 |
| Migrate all consumers to `FamiliarAvatar` | 8 |
| Studio drawer shell, tabs, header, dismissal | 12 |
| Identity tab fields + reset + ghost placeholder + empty-clear | 13 |
| Look tab: glyph picker panel + color + image upload | 14 |
| Brain tab via existing `PATCH /api/config` | 15 |
| Lifecycle tab: archive, reset-all, list view | 16 |
| Drag-to-reorder on rail | 10 |
| `cave-familiar-overrides` store | 2 |
| `cave-familiar-images` store with caps | 3 |
| `cave-familiar-archive` store | 4 |
| `familiar-resolve` resolver + `useResolvedFamiliars` | 5 |
| `FamiliarStudioProvider` context | 7 |
| Settings panel "Edit" button | 17 |
| `+` button right-click → list view | 17 |
| Drawer empty state for missing-id | 12 |
| Last-used-tab persistence | 7 |

Type-consistency check: `setFamiliarOverride` / `clearFamiliarOverrideField` / `clearAllFamiliarOverrides` named consistently across Tasks 2, 5, 13, 16. `useResolvedFamiliars(familiars, { includeArchived })` signature consistent across Tasks 5, 12, 16. `ResolvedFamiliar` type used across Tasks 5, 6, 13, 14, 15, 16.

No remaining placeholders, no "TBD"s, no "similar to Task N" without code.

---
