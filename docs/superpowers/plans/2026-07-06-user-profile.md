# User Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Server-side operator profile (name, pronouns, bio, timezone, links) plus a server-stored avatar image, editable in a new Settings → Profile section, consumed by chat surfaces and injected as operator context for familiars.

**Architecture:** Text fields live under a new `profile` key in `~/.coven/cave-config.json` (existing `loadConfig`/`saveConfig`, atomic writes). The avatar is a file `~/.coven/user-avatar.{png,jpg,webp}` served by `/api/profile/avatar`. A client module store (`useSyncExternalStore` + BroadcastChannel, mirroring `src/lib/user-avatar-image.ts`) feeds all render sites; `"You"` becomes a fallback. `/api/chat/send` prepends an operator-profile block through the existing `buildPromptWithFamiliarStartupContext` mechanism on new sessions only.

**Tech Stack:** Next.js App Router API routes (nodejs runtime), React 18 `useSyncExternalStore`, node:test + `--experimental-strip-types` (tests must be added to the hard-coded lists in `package.json` — CI only runs listed files).

**Spec:** `docs/superpowers/specs/2026-07-06-user-profile-design.md`
**Bead:** cave-5aw · **Branch:** `feat/user-profile` · **Worktree:** `.worktrees/feat-user-profile`

**Conventions that apply to every task:**
- Run commands from the worktree root: `cd .worktrees/feat-user-profile`.
- Commits are signed (`git commit -S`) and pushed after every commit (`git push -u origin feat/user-profile`).
- Test runner: `node --experimental-strip-types <file>` for `.ts` tests.
- Icons: any new icon name must exist in `ICON_NAMES` in `src/lib/icon.tsx` (`ph:user-circle` — check; add if missing).

---

### Task 0: Commit spec + plan

**Files:**
- Add: `docs/superpowers/specs/2026-07-06-user-profile-design.md` (copy from main checkout — it was written there, uncommitted)
- Add: `docs/superpowers/plans/2026-07-06-user-profile.md` (this file)

- [ ] **Step 1:** `cp ../../docs/superpowers/specs/2026-07-06-user-profile-design.md docs/superpowers/specs/` (plan file is already in the worktree).
- [ ] **Step 2:** `git add docs/superpowers && git commit -S -m "docs: user profile spec + implementation plan (cave-5aw)" && git push -u origin feat/user-profile`

---

### Task 1: Profile types + validation (`src/lib/user-profile-shared.ts`)

Pure, isomorphic validation shared by the API route and (later) the Settings panel.

**Files:**
- Create: `src/lib/user-profile-shared.ts`
- Test: `src/lib/user-profile-shared.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/user-profile-shared.test.ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  normalizeUserProfilePatch,
  userDisplayName,
  PROFILE_LIMITS,
} from "./user-profile-shared.ts";

describe("normalizeUserProfilePatch", () => {
  it("trims and accepts valid fields", () => {
    const res = normalizeUserProfilePatch({
      name: "  Buns ", pronouns: "they/them", bio: "hi", timezone: "America/Chicago",
      links: [{ label: "GitHub", url: "https://github.com/BunsDev" }],
    });
    assert.ok(res.ok);
    assert.equal(res.patch.name, "Buns");
    assert.equal(res.patch.links?.[0].url, "https://github.com/BunsDev");
  });
  it("empty string clears a field (null in patch)", () => {
    const res = normalizeUserProfilePatch({ name: "" });
    assert.ok(res.ok);
    assert.equal(res.patch.name, null);
  });
  it("rejects unknown keys", () => {
    const res = normalizeUserProfilePatch({ nickname: "x" } as Record<string, unknown>);
    assert.ok(!res.ok);
    assert.match(res.error, /unknown field: nickname/);
  });
  it("rejects over-limit lengths", () => {
    const res = normalizeUserProfilePatch({ name: "x".repeat(PROFILE_LIMITS.name + 1) });
    assert.ok(!res.ok);
    assert.match(res.error, /name/);
  });
  it("rejects bad timezone and non-http links", () => {
    assert.ok(!normalizeUserProfilePatch({ timezone: "Mars/Olympus" }).ok);
    assert.ok(!normalizeUserProfilePatch({ links: [{ label: "x", url: "javascript:alert(1)" }] }).ok);
    assert.ok(!normalizeUserProfilePatch({ links: Array.from({ length: 9 }, (_, i) => ({ label: `l${i}`, url: "https://a.b" })) }).ok);
  });
});

describe("userDisplayName", () => {
  it("falls back to You", () => {
    assert.equal(userDisplayName(null), "You");
    assert.equal(userDisplayName({ name: "  " }), "You");
    assert.equal(userDisplayName({ name: "Buns" }), "Buns");
  });
});
```

- [ ] **Step 2:** Run `node --experimental-strip-types src/lib/user-profile-shared.test.ts` — expect FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// src/lib/user-profile-shared.ts
/**
 * Operator profile — shared types + validation.
 *
 * Isomorphic on purpose: the /api/profile PATCH route and the Settings panel
 * validate with the same rules. Persistence lives in cave-config.ts (text) and
 * user-avatar-file.ts (image) — this module is pure.
 */

export type ProfileLink = { label: string; url: string };

export type UserProfile = {
  name?: string;
  pronouns?: string;
  bio?: string;
  /** IANA timezone id. Unset = system. */
  timezone?: string;
  links?: ProfileLink[];
};

export const PROFILE_LIMITS = {
  name: 64,
  pronouns: 32,
  bio: 2000,
  linkLabel: 32,
  linkUrl: 512,
  links: 8,
} as const;

const PATCH_KEYS = new Set(["name", "pronouns", "bio", "timezone", "links"]);

/** Patch semantics: string fields — trimmed value sets, "" clears (null).
 *  `links` — array replaces, [] clears (null). Absent keys untouched. */
export type UserProfilePatch = {
  name?: string | null;
  pronouns?: string | null;
  bio?: string | null;
  timezone?: string | null;
  links?: ProfileLink[] | null;
};

export type NormalizeResult =
  | { ok: true; patch: UserProfilePatch }
  | { ok: false; error: string };

function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function normText(
  value: unknown, field: "name" | "pronouns" | "bio",
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (typeof value !== "string") return { ok: false, error: `${field} must be a string` };
  const trimmed = value.trim();
  if (trimmed.length > PROFILE_LIMITS[field]) {
    return { ok: false, error: `${field} is too long (max ${PROFILE_LIMITS[field]} characters)` };
  }
  return { ok: true, value: trimmed === "" ? null : trimmed };
}

export function normalizeUserProfilePatch(body: Record<string, unknown>): NormalizeResult {
  for (const key of Object.keys(body)) {
    if (!PATCH_KEYS.has(key)) return { ok: false, error: `unknown field: ${key}` };
  }
  const patch: UserProfilePatch = {};
  for (const field of ["name", "pronouns", "bio"] as const) {
    if (field in body) {
      const res = normText(body[field], field);
      if (!res.ok) return res;
      patch[field] = res.value;
    }
  }
  if ("timezone" in body) {
    if (typeof body.timezone !== "string") return { ok: false, error: "timezone must be a string" };
    const tz = body.timezone.trim();
    if (tz === "") patch.timezone = null;
    else if (!isValidTimezone(tz)) return { ok: false, error: `unknown timezone: ${tz}` };
    else patch.timezone = tz;
  }
  if ("links" in body) {
    if (!Array.isArray(body.links)) return { ok: false, error: "links must be an array" };
    if (body.links.length > PROFILE_LIMITS.links) {
      return { ok: false, error: `too many links (max ${PROFILE_LIMITS.links})` };
    }
    const links: ProfileLink[] = [];
    for (const raw of body.links) {
      const label = typeof (raw as ProfileLink)?.label === "string" ? (raw as ProfileLink).label.trim() : "";
      const url = typeof (raw as ProfileLink)?.url === "string" ? (raw as ProfileLink).url.trim() : "";
      if (!label || label.length > PROFILE_LIMITS.linkLabel) return { ok: false, error: "link label is required (max 32 characters)" };
      if (url.length > PROFILE_LIMITS.linkUrl || !isHttpUrl(url)) return { ok: false, error: `link URL must be http(s): ${label}` };
      links.push({ label, url });
    }
    patch.links = links.length === 0 ? null : links;
  }
  return { ok: true, patch };
}

/** Apply a normalized patch to a stored profile; returns undefined when empty. */
export function applyUserProfilePatch(
  current: UserProfile | undefined, patch: UserProfilePatch,
): UserProfile | undefined {
  const next: UserProfile = { ...(current ?? {}) };
  for (const key of ["name", "pronouns", "bio", "timezone", "links"] as const) {
    if (!(key in patch)) continue;
    const value = patch[key];
    if (value === null) delete next[key];
    else (next as Record<string, unknown>)[key] = value;
  }
  return Object.keys(next).length === 0 ? undefined : next;
}

export function userDisplayName(profile: UserProfile | null | undefined): string {
  return profile?.name?.trim() || "You";
}
```

- [ ] **Step 4:** Run the test — expect PASS.
- [ ] **Step 5:** Wire into `package.json` `test:app` list (see Task 8 for the exact mechanics — do it now for this file): add `src/lib/user-profile-shared.test.ts` to the `test:app` suite list consumed by `scripts/run-tests.mjs` (the SUITES map in that script — add the path to the `app` array). Run `node scripts/check-tests-wired.mjs` — expect PASS.
- [ ] **Step 6:** `git add -A && git commit -S -m "feat(profile): shared operator-profile types + patch validation (cave-5aw)" && git push`

---

### Task 2: `profile` key in cave-config

**Files:**
- Modify: `src/lib/cave-config.ts` (type at ~line 151, `loadConfig` return at ~line 200, `saveConfig` merge at ~line 355, `CaveConfigPatch` at ~line 94)

- [ ] **Step 1:** Import the type at the top of `cave-config.ts`:

```ts
import type { UserProfile } from "@/lib/user-profile-shared";
```

- [ ] **Step 2:** Add to the `CaveConfig` type, after `remoteHosts`:

```ts
  /** Operator profile (Settings → Profile). Image lives in ~/.coven/user-avatar.*, not here. */
  profile?: UserProfile;
```

- [ ] **Step 3:** In `loadConfig`'s explicit return object (it drops unknown keys — `profile` must be listed or every save-cycle loses it), add:

```ts
      profile: parsed.profile,
```

- [ ] **Step 4:** In `saveConfig`'s `updated` object add replace-if-provided semantics (callers pass a full, already-validated profile or `undefined` to clear):

```ts
    profile: "profile" in patch ? patch.profile : current.profile,
```

  Note: `CaveConfigPatch` is `Omit<Partial<CaveConfig>, "defaults" | "familiars"> & …` so `profile?: UserProfile` is already included — no patch-type change needed. The `"profile" in patch` check (not `!== undefined`) is what lets `saveConfig({ profile: undefined })` clear the key.

- [ ] **Step 5:** `pnpm typecheck` — expect clean.
- [ ] **Step 6:** `git add -A && git commit -S -m "feat(profile): persist operator profile in cave-config.json (cave-5aw)" && git push`

---

### Task 3: Avatar file store (`src/lib/server/user-avatar-file.ts`)

**Files:**
- Create: `src/lib/server/user-avatar-file.ts`
- Test: `src/lib/server/user-avatar-file.test.ts`

- [ ] **Step 1: Write the failing test** (uses a temp dir override so it never touches `~/.coven`):

```ts
// src/lib/server/user-avatar-file.test.ts
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import {
  deleteUserAvatarFile, readUserAvatarFile, writeUserAvatarFile,
} from "./user-avatar-file.ts";

const dir = await mkdtemp(path.join(tmpdir(), "cave-avatar-"));
after(() => rm(dir, { recursive: true, force: true }));

// 1x1 transparent PNG
const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const PNG_DATAURL = `data:image/png;base64,${PNG_B64}`;

describe("user avatar file store", () => {
  it("writes, reads back, and reports mime", async () => {
    const res = await writeUserAvatarFile({ dataUrl: PNG_DATAURL, mime: "image/png" }, dir);
    assert.ok(res.ok);
    const read = await readUserAvatarFile(dir);
    assert.ok(read);
    assert.equal(read.mime, "image/png");
    assert.ok(read.bytes.byteLength > 0);
    assert.ok(read.updatedAt);
  });
  it("replacing with another format removes the old file", async () => {
    const webp = `data:image/webp;base64,${PNG_B64}`; // content irrelevant; store trusts declared mime
    const res = await writeUserAvatarFile({ dataUrl: webp, mime: "image/webp" }, dir);
    assert.ok(res.ok);
    const read = await readUserAvatarFile(dir);
    assert.equal(read?.mime, "image/webp");
  });
  it("rejects svg and oversized payloads", async () => {
    const svg = await writeUserAvatarFile({ dataUrl: "data:image/svg+xml;base64,AAA", mime: "image/svg+xml" }, dir);
    assert.ok(!svg.ok);
    const big = await writeUserAvatarFile(
      { dataUrl: `data:image/png;base64,${"A".repeat(3 * 1024 * 1024)}`, mime: "image/png" }, dir);
    assert.ok(!big.ok);
  });
  it("rejects a dataUrl whose header mime disagrees with the declared mime", async () => {
    const res = await writeUserAvatarFile({ dataUrl: PNG_DATAURL, mime: "image/webp" }, dir);
    assert.ok(!res.ok);
  });
  it("delete removes the file; read returns null", async () => {
    await deleteUserAvatarFile(dir);
    assert.equal(await readUserAvatarFile(dir), null);
  });
});
```

- [ ] **Step 2:** Run `node --experimental-strip-types src/lib/server/user-avatar-file.test.ts` — expect FAIL.

- [ ] **Step 3: Implement**

```ts
// src/lib/server/user-avatar-file.ts
/**
 * Operator avatar image — a single file under ~/.coven named
 * user-avatar.{png,jpg,webp}. Exactly one exists at a time: writes are atomic
 * (unique temp + rename, same recipe as atomic-write.ts) and remove the other
 * extensions after the rename so a format change can't leave two avatars.
 *
 * SVG is rejected here even though the browser-local legacy store allowed it —
 * this image is now served from our origin (stored-XSS vector).
 */
import { readFile, rename, rm, stat, writeFile, mkdir } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";

export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

const MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};
const ALL_EXTS = ["png", "jpg", "webp"];

function avatarDir(override?: string): string {
  return override ?? path.join(homedir(), ".coven");
}
function avatarPath(dir: string, ext: string): string {
  return path.join(dir, `user-avatar.${ext}`);
}
function extToMime(ext: string): string {
  return ext === "png" ? "image/png" : ext === "jpg" ? "image/jpeg" : "image/webp";
}

export type UserAvatarFile = { bytes: Buffer; mime: string; updatedAt: string };
export type AvatarWriteResult = { ok: true } | { ok: false; reason: string };

export async function readUserAvatarFile(dirOverride?: string): Promise<UserAvatarFile | null> {
  const dir = avatarDir(dirOverride);
  for (const ext of ALL_EXTS) {
    const file = avatarPath(dir, ext);
    try {
      const info = await stat(file);
      if (!info.isFile()) continue;
      return {
        bytes: await readFile(file),
        mime: extToMime(ext),
        updatedAt: info.mtime.toISOString(),
      };
    } catch { /* try next ext */ }
  }
  return null;
}

export async function writeUserAvatarFile(
  image: { dataUrl: string; mime: string }, dirOverride?: string,
): Promise<AvatarWriteResult> {
  const ext = MIME_TO_EXT[image.mime];
  if (!ext) return { ok: false, reason: "Unsupported format. Use PNG, JPEG, or WebP." };
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(image.dataUrl);
  if (!match) return { ok: false, reason: "Invalid image data." };
  if (match[1] !== image.mime) return { ok: false, reason: "Image data does not match its declared format." };
  if (image.dataUrl.length > MAX_AVATAR_BYTES * 1.4) return { ok: false, reason: "Image too large (max 2MB)." };
  let bytes: Buffer;
  try {
    bytes = Buffer.from(match[2], "base64");
  } catch {
    return { ok: false, reason: "Invalid image data." };
  }
  if (bytes.byteLength === 0) return { ok: false, reason: "Invalid image data." };
  if (bytes.byteLength > MAX_AVATAR_BYTES) return { ok: false, reason: "Image too large (max 2MB)." };

  const dir = avatarDir(dirOverride);
  await mkdir(dir, { recursive: true });
  const target = avatarPath(dir, ext);
  const tmp = `${target}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    await writeFile(tmp, bytes);
    await rename(tmp, target);
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => {});
    return { ok: false, reason: err instanceof Error ? err.message : "Could not save image." };
  }
  // Sweep the other extensions so a format change leaves exactly one avatar.
  for (const other of ALL_EXTS.filter((e) => e !== ext)) {
    await rm(avatarPath(dir, other), { force: true }).catch(() => {});
  }
  return { ok: true };
}

export async function deleteUserAvatarFile(dirOverride?: string): Promise<void> {
  const dir = avatarDir(dirOverride);
  for (const ext of ALL_EXTS) {
    await rm(avatarPath(dir, ext), { force: true }).catch(() => {});
  }
}
```

- [ ] **Step 4:** Run the test — expect PASS.
- [ ] **Step 5:** Add `src/lib/server/user-avatar-file.test.ts` to the `api` suite list in `scripts/run-tests.mjs`. Run `node scripts/check-tests-wired.mjs` — PASS.
- [ ] **Step 6:** `git add -A && git commit -S -m "feat(profile): server avatar file store with atomic single-file writes (cave-5aw)" && git push`

---

### Task 4: API routes (`/api/profile`, `/api/profile/avatar`)

**Files:**
- Create: `src/app/api/profile/route.ts`
- Create: `src/app/api/profile/avatar/route.ts`
- Test: `src/app/api/profile-route.test.ts`

- [ ] **Step 1: Write the failing test** (source-invariant style, matching `src/app/api/familiar-self-report-route.test.ts` conventions):

```ts
// src/app/api/profile-route.test.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const profileRoute = readFileSync(
  fileURLToPath(new URL("./profile/route.ts", import.meta.url)), "utf8");
const avatarRoute = readFileSync(
  fileURLToPath(new URL("./profile/avatar/route.ts", import.meta.url)), "utf8");

describe("profile routes", () => {
  it("PATCH validates through the shared normalizer, not ad-hoc checks", () => {
    assert.match(profileRoute, /normalizeUserProfilePatch/);
    assert.match(profileRoute, /applyUserProfilePatch/);
  });
  it("profile writes persist via saveConfig (atomic), never raw fs", () => {
    assert.match(profileRoute, /saveConfig\(/);
    assert.doesNotMatch(profileRoute, /writeFile|fs\/promises/);
  });
  it("/api/config does not accept profile writes (validated route only)", () => {
    const configRoute = readFileSync(
      fileURLToPath(new URL("./config/route.ts", import.meta.url)), "utf8");
    assert.doesNotMatch(configRoute, /"profile"/);
  });
  it("avatar GET serves bytes with content-type and etag; POST/DELETE go through the file store", () => {
    assert.match(avatarRoute, /readUserAvatarFile/);
    assert.match(avatarRoute, /writeUserAvatarFile/);
    assert.match(avatarRoute, /deleteUserAvatarFile/);
    assert.match(avatarRoute, /ETag/i);
    assert.match(avatarRoute, /Content-Type/i);
  });
  it("avatar route never accepts svg", () => {
    assert.doesNotMatch(avatarRoute, /svg/i);
  });
});
```

- [ ] **Step 2:** Run it — expect FAIL (files missing).

- [ ] **Step 3: Implement `src/app/api/profile/route.ts`**

```ts
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { loadConfig, saveConfig } from "@/lib/cave-config";
import {
  applyUserProfilePatch,
  normalizeUserProfilePatch,
} from "@/lib/user-profile-shared";
import { readUserAvatarFile } from "@/lib/server/user-avatar-file";

export async function GET() {
  try {
    const [config, avatar] = await Promise.all([loadConfig(), readUserAvatarFile()]);
    return NextResponse.json({
      ok: true,
      profile: config.profile ?? {},
      avatar: avatar ? { present: true, updatedAt: avatar.updatedAt } : { present: false },
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "failed to load profile" },
      { status: 500 },
    );
  }
}

export async function PATCH(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  const normalized = normalizeUserProfilePatch(body);
  if (!normalized.ok) {
    return NextResponse.json({ ok: false, error: normalized.error }, { status: 400 });
  }
  try {
    const current = await loadConfig();
    const profile = applyUserProfilePatch(current.profile, normalized.patch);
    const updated = await saveConfig({ profile });
    return NextResponse.json({ ok: true, profile: updated.profile ?? {} });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "failed to save profile" },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 4: Implement `src/app/api/profile/avatar/route.ts`**

```ts
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import {
  deleteUserAvatarFile,
  readUserAvatarFile,
  writeUserAvatarFile,
} from "@/lib/server/user-avatar-file";

export async function GET() {
  const avatar = await readUserAvatarFile();
  if (!avatar) return new NextResponse(null, { status: 404 });
  return new NextResponse(new Uint8Array(avatar.bytes), {
    status: 200,
    headers: {
      "Content-Type": avatar.mime,
      "Cache-Control": "no-cache",
      ETag: `"${avatar.updatedAt}-${avatar.bytes.byteLength}"`,
    },
  });
}

export async function POST(req: NextRequest) {
  let body: { dataUrl?: unknown; mime?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  if (typeof body.dataUrl !== "string" || typeof body.mime !== "string") {
    return NextResponse.json({ ok: false, error: "dataUrl and mime are required" }, { status: 400 });
  }
  const res = await writeUserAvatarFile({ dataUrl: body.dataUrl, mime: body.mime });
  if (!res.ok) return NextResponse.json({ ok: false, error: res.reason }, { status: 400 });
  const avatar = await readUserAvatarFile();
  return NextResponse.json({ ok: true, updatedAt: avatar?.updatedAt ?? null });
}

export async function DELETE() {
  await deleteUserAvatarFile();
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 5:** Run the test — expect PASS. `pnpm typecheck` — clean.
- [ ] **Step 6:** Add `src/app/api/profile-route.test.ts` to the `api` suite list in `scripts/run-tests.mjs`; `node scripts/check-tests-wired.mjs` — PASS.
- [ ] **Step 7:** `git add -A && git commit -S -m "feat(profile): /api/profile + /api/profile/avatar routes (cave-5aw)" && git push`

---

### Task 5: Client store (`src/lib/user-profile.ts`)

**Files:**
- Create: `src/lib/user-profile.ts`
- Test: `src/lib/user-profile.test.ts`

- [ ] **Step 1: Write the failing test** (source-invariant — the store's fetch/BroadcastChannel behavior is patterned on `user-avatar-image.ts`, whose logic is covered there; here assert the contract):

```ts
// src/lib/user-profile.test.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const source = readFileSync(
  fileURLToPath(new URL("./user-profile.ts", import.meta.url)), "utf8");

describe("user-profile client store", () => {
  it("subscribes through useSyncExternalStore with a null server snapshot", () => {
    assert.match(source, /useSyncExternalStore\(subscribe, getSnapshot, getServerSnapshot\)/);
    assert.match(source, /getServerSnapshot = \(\) => null/);
  });
  it("cross-window sync uses a BroadcastChannel and re-fetches on message", () => {
    assert.match(source, /BroadcastChannel/);
    assert.match(source, /cave:user-profile/);
  });
  it("saves commit to memory only after a 2xx (persist-first)", () => {
    assert.match(source, /if \(!res\.ok \|\| !json\?\.ok\)/);
  });
  it("exposes avatar URL with an updatedAt cache-buster", () => {
    assert.match(source, /\/api\/profile\/avatar\?v=/);
  });
});
```

- [ ] **Step 2:** Run — FAIL.

- [ ] **Step 3: Implement**

```ts
// src/lib/user-profile.ts
"use client";

/**
 * Client store for the server-side operator profile (GET/PATCH /api/profile).
 * Mirrors the module-store pattern of user-avatar-image.ts: in-memory snapshot,
 * useSyncExternalStore subscription, BroadcastChannel cross-window sync.
 * Persist-first: the snapshot only updates after the server accepted a write.
 */

import { useSyncExternalStore } from "react";
import type { UserProfile, UserProfilePatch } from "@/lib/user-profile-shared";
export { userDisplayName } from "@/lib/user-profile-shared";
export type { UserProfile } from "@/lib/user-profile-shared";

export type UserProfileSnapshot = {
  profile: UserProfile;
  avatar: { present: boolean; updatedAt?: string };
};

const CHANNEL_NAME = "cave:user-profile";

let cached: UserProfileSnapshot | null = null;
let hydration: Promise<void> | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const fn of listeners) fn();
}

let channel: BroadcastChannel | null = null;
function ensureChannel(): void {
  if (channel || typeof BroadcastChannel === "undefined") return;
  channel = new BroadcastChannel(CHANNEL_NAME);
  channel.onmessage = () => {
    hydration = null;
    void ensureHydrated();
  };
  (channel as { unref?: () => void }).unref?.();
}
function broadcast(): void {
  ensureChannel();
  channel?.postMessage("changed");
}

async function hydrate(): Promise<void> {
  if (typeof window === "undefined") return;
  ensureChannel();
  try {
    const res = await fetch("/api/profile");
    const json = (await res.json()) as { ok?: boolean; profile?: UserProfile; avatar?: UserProfileSnapshot["avatar"] };
    if (res.ok && json?.ok) {
      cached = { profile: json.profile ?? {}, avatar: json.avatar ?? { present: false } };
      notify();
    }
  } catch { /* daemon offline — keep previous snapshot (or null → "You") */ }
}

function ensureHydrated(): Promise<void> {
  if (!hydration) hydration = hydrate();
  return hydration;
}

if (typeof window !== "undefined") void ensureHydrated();

export type SaveResult = { ok: true } | { ok: false; reason: string };

export async function saveUserProfile(patch: UserProfilePatch): Promise<SaveResult> {
  const res = await fetch("/api/profile", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  }).catch(() => null);
  const json = res ? ((await res.json().catch(() => null)) as { ok?: boolean; profile?: UserProfile; error?: string } | null) : null;
  if (!res || !res.ok || !json?.ok) {
    return { ok: false, reason: json?.error ?? "Could not save profile." };
  }
  cached = { profile: json.profile ?? {}, avatar: cached?.avatar ?? { present: false } };
  notify();
  broadcast();
  return { ok: true };
}

export async function uploadUserProfileAvatar(image: { dataUrl: string; mime: string }): Promise<SaveResult> {
  const res = await fetch("/api/profile/avatar", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(image),
  }).catch(() => null);
  const json = res ? ((await res.json().catch(() => null)) as { ok?: boolean; updatedAt?: string; error?: string } | null) : null;
  if (!res || !res.ok || !json?.ok) {
    return { ok: false, reason: json?.error ?? "Could not upload image." };
  }
  cached = {
    profile: cached?.profile ?? {},
    avatar: { present: true, updatedAt: json.updatedAt ?? new Date().toISOString() },
  };
  notify();
  broadcast();
  return { ok: true };
}

export async function removeUserProfileAvatar(): Promise<void> {
  const res = await fetch("/api/profile/avatar", { method: "DELETE" }).catch(() => null);
  if (!res?.ok) return;
  cached = { profile: cached?.profile ?? {}, avatar: { present: false } };
  notify();
  broadcast();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const getSnapshot = () => cached;
const getServerSnapshot = () => null;

export function useUserProfile(): UserProfileSnapshot | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function readUserProfileSnapshot(): UserProfileSnapshot | null {
  return cached;
}

/** `/api/profile/avatar?v=<updatedAt>` when present, else null. */
export function userAvatarUrl(snapshot: UserProfileSnapshot | null): string | null {
  if (!snapshot?.avatar.present) return null;
  return `/api/profile/avatar?v=${encodeURIComponent(snapshot.avatar.updatedAt ?? "0")}`;
}

/** Resolves once the profile has been fetched (used by the avatar migration). */
export function whenUserProfileHydrated(): Promise<void> {
  return ensureHydrated();
}
```

  Note the persist-first guard shape must literally include `if (!res.ok || !json?.ok)` — adjust the combined null-check line to satisfy both the compiler and the invariant test: write the guard as `if (!res || !res.ok || !json?.ok)` in code and relax the test regex to `/!res\.ok \|\| !json\?\.ok/` (already matches as a substring).

- [ ] **Step 4:** Run the test — PASS. `pnpm typecheck` — clean.
- [ ] **Step 5:** Wire `src/lib/user-profile.test.ts` into the `app` suite in `scripts/run-tests.mjs`; check-tests-wired PASS.
- [ ] **Step 6:** `git add -A && git commit -S -m "feat(profile): client profile store with cross-window sync (cave-5aw)" && git push`

---

### Task 6: Settings → Profile section

**Files:**
- Modify: `src/components/settings-sections.ts` (add section id/meta/highlights/index entries)
- Create: `src/components/settings-profile.tsx`
- Modify: `src/components/settings-shell.tsx` (~line 340: render block; import)
- Modify: `src/lib/icon.tsx` (only if `ph:user-circle` missing from `ICON_NAMES`)
- Test: `src/components/settings-profile.test.ts`

- [ ] **Step 1:** Check the icon: `grep -n '"ph:user-circle"' src/lib/icon.tsx` — if absent, add `"ph:user-circle",` to `ICON_NAMES` (alphabetical position near other `ph:user*` names).

- [ ] **Step 2: Write the failing test**

```ts
// src/components/settings-profile.test.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { SECTIONS, SETTINGS_INDEX } from "./settings-sections.ts";

const panel = readFileSync(
  fileURLToPath(new URL("./settings-profile.tsx", import.meta.url)), "utf8");
const shell = readFileSync(
  fileURLToPath(new URL("./settings-shell.tsx", import.meta.url)), "utf8");

describe("Settings → Profile", () => {
  it("registers first in the section catalog", () => {
    assert.equal(SECTIONS[0]?.id, "profile");
    assert.equal(SECTIONS[0]?.icon, "ph:user-circle");
  });
  it("is searchable (name, pronouns, timezone, avatar, links)", () => {
    const entries = SETTINGS_INDEX.filter((e) => e.section === "profile");
    const keywords = entries.map((e) => e.keywords).join(" ");
    for (const term of ["name", "pronouns", "timezone", "avatar", "bio", "links"]) {
      assert.match(keywords, new RegExp(term));
    }
  });
  it("shell renders the panel for the profile section", () => {
    assert.match(shell, /section === "profile" && <ProfileSection \/>/);
  });
  it("saves text fields on blur through the shared store and announces outcomes", () => {
    assert.match(panel, /saveUserProfile/);
    assert.match(panel, /onBlur/);
    assert.match(panel, /useAnnouncer/);
  });
  it("uploads through the shared image prepare pipeline and the server store", () => {
    assert.match(panel, /prepareFamiliarImage/);
    assert.match(panel, /uploadUserProfileAvatar/);
    assert.match(panel, /removeUserProfileAvatar/);
  });
  it("timezone options come from Intl with a system default", () => {
    assert.match(panel, /supportedValuesOf\("timeZone"\)/);
    assert.match(panel, /resolvedOptions\(\)\.timeZone/);
  });
});
```

- [ ] **Step 3:** Run — FAIL.

- [ ] **Step 4: Update `settings-sections.ts`:** add `"profile"` first in the `Section` union; prepend to `SECTIONS`:

```ts
  { id: "profile", label: "Profile", icon: "ph:user-circle", description: "Your name, image, and details familiars know you by.", accent: "#f0c987" },
```

  Add to `SECTION_HIGHLIGHTS`:

```ts
  profile: ["Display name & pronouns", "Profile image", "Bio, timezone & links"],
```

  Prepend to `SETTINGS_INDEX`:

```ts
  { section: "profile", group: "Identity", keywords: "profile name display pronouns identity operator user you" },
  { section: "profile", group: "Image", keywords: "avatar image photo picture upload face profile" },
  { section: "profile", group: "Details", keywords: "bio about timezone time zone links github socials url" },
```

- [ ] **Step 5: Create `src/components/settings-profile.tsx`.** Follow the local field/group components used inside `settings-shell.tsx` (`SettingsGroup`, labeled inputs — read the `GeneralSection` implementation at `settings-shell.tsx:363` first and reuse its primitives; if they are file-local, export them or copy the minimal markup pattern). Functional requirements (all shown code is the required logic; adapt markup to the shared primitives):

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/lib/icon";
import { useAnnouncer } from "@/components/ui/live-region";
import { FAMILIAR_IMAGE_ACCEPT, prepareFamiliarImage } from "@/lib/familiar-image-upload";
import {
  saveUserProfile, uploadUserProfileAvatar, removeUserProfileAvatar,
  useUserProfile, userAvatarUrl, userDisplayName,
} from "@/lib/user-profile";
import { PROFILE_LIMITS, type ProfileLink } from "@/lib/user-profile-shared";

// Upload accept list minus SVG — the server rejects it (stored-XSS via same-origin serving).
const PROFILE_IMAGE_ACCEPT = FAMILIAR_IMAGE_ACCEPT.split(",").filter((m) => m !== "image/svg+xml").join(",");

export function ProfileSection() {
  const snapshot = useUserProfile();
  const { announce } = useAnnouncer();
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  // Local drafts initialized from the snapshot; PATCH on blur when changed.
  const [name, setName] = useState("");
  const [pronouns, setPronouns] = useState("");
  const [bio, setBio] = useState("");
  const [timezone, setTimezone] = useState("");
  const [links, setLinks] = useState<ProfileLink[]>([]);
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (!snapshot || hydratedRef.current) return;
    hydratedRef.current = true;
    setName(snapshot.profile.name ?? "");
    setPronouns(snapshot.profile.pronouns ?? "");
    setBio(snapshot.profile.bio ?? "");
    setTimezone(snapshot.profile.timezone ?? "");
    setLinks(snapshot.profile.links ?? []);
  }, [snapshot]);

  const save = async (patch: Parameters<typeof saveUserProfile>[0], label: string) => {
    setError(null);
    const res = await saveUserProfile(patch);
    if (!res.ok) { setError(res.reason); announce(res.reason, "assertive"); }
    else announce(`${label} saved.`);
  };

  const systemTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const timezones = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [systemTz];
  const avatarSrc = userAvatarUrl(snapshot);

  // …render: avatar block (img or initial of userDisplayName(snapshot?.profile)),
  // hidden file input (accept={PROFILE_IMAGE_ACCEPT}) → prepareFamiliarImage(file)
  //   → uploadUserProfileAvatar(prepared) → announce/setError,
  // Remove button → removeUserProfileAvatar(),
  // name/pronouns inputs (maxLength from PROFILE_LIMITS, onBlur → save({ name }, "Name")),
  // timezone <select> ("" option labelled `System (${systemTz})` → save({ timezone }, …)),
  // bio textarea with `${bio.length}/${PROFILE_LIMITS.bio}` counter shown at ≥90%,
  // links rows (label+url inputs, add ≤ PROFILE_LIMITS.links, remove) —
  //   row blur → save({ links }, "Links") only when both fields are non-empty,
  // inline {error} line, daemon-offline note when snapshot stays null.
  // Use .focus-ring on all interactive elements; every input gets a <label htmlFor>.
}
```

  The rendered markup must follow the existing `settings-shell.tsx` group/field appearance — read `GeneralSection` before writing it, and place `ProfileSection` in its own file (this shell is already ~2k lines; export it and import into the shell).

- [ ] **Step 6: Wire into `settings-shell.tsx`:** import `{ ProfileSection } from "@/components/settings-profile"` and add as the FIRST render branch in the `<main>` block (~line 340):

```tsx
          {section === "profile"  && <ProfileSection />}
```

  Also confirm the shell's section list/keyboard nav derives from `SECTIONS` (it does — `SECTIONS.find` at line 124) so no additional nav change is needed.

- [ ] **Step 7:** Run the test — PASS. `pnpm typecheck` — clean.
- [ ] **Step 8:** Wire `src/components/settings-profile.test.ts` into the `app` suite; check-tests-wired PASS.
- [ ] **Step 9:** Manual smoke: `pnpm dev`, open Settings → Profile, set a name, upload an image, reload, confirm both persist (they now live in `~/.coven`).
- [ ] **Step 10:** `git add -A && git commit -S -m "feat(profile): Settings → Profile section (cave-5aw)" && git push`

---

### Task 7: Consume the profile — avatar component, "You" swaps, migration

**Files:**
- Modify: `src/components/user-chat-avatar.tsx` (display-only; server avatar; opens Settings)
- Modify: `src/components/user-chat-avatar.test.ts` (update invariants)
- Modify: `src/components/chat-view.tsx:3829` and `:5624`
- Modify: `src/components/group-chat-view.tsx:390`, `:475` (roster entries) and the `cave-group-chat-name` span (~line 788 region: `<span className="cave-group-chat-name">You</span>`)
- Modify: `src/lib/permissions-console.ts:229`
- Create: `src/lib/user-avatar-migrate.ts` (one-time IndexedDB → server upload)
- Test: `src/components/user-profile-invariants.test.ts`

- [ ] **Step 1: Write the failing invariant test**

```ts
// src/components/user-profile-invariants.test.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const chatView = read("./chat-view.tsx");
const groupChat = read("./group-chat-view.tsx");
const avatar = read("./user-chat-avatar.tsx");

describe("operator profile consumption", () => {
  it("chat turn labels route through userDisplayName, not hard-coded You", () => {
    assert.match(chatView, /userDisplayName\(/);
    assert.doesNotMatch(chatView, /turn\.role === "system" \? "System" : "You"/);
  });
  it("group chat roster + turn name use the profile name", () => {
    assert.match(groupChat, /userDisplayName\(/);
    assert.doesNotMatch(groupChat, /name: "You"/);
  });
  it("user avatar renders the server image and opens Settings instead of inline upload", () => {
    assert.match(avatar, /userAvatarUrl/);
    assert.doesNotMatch(avatar, /setUserAvatarImage/);
    assert.doesNotMatch(avatar, /<input/);
  });
});
```

- [ ] **Step 2:** Run — FAIL.

- [ ] **Step 3: Rework `src/components/user-chat-avatar.tsx`** (full replacement):

```tsx
"use client";

import { Icon } from "@/lib/icon";
import { useUserProfile, userAvatarUrl, userDisplayName } from "@/lib/user-profile";
import { runUserAvatarMigration } from "@/lib/user-avatar-migrate";
import { useEffect } from "react";

type Props = {
  className?: string;
  ariaLabel?: string;
};

/** Operator avatar — displays the server-stored profile image. Editing moved
 *  to Settings → Profile; clicking navigates there. */
export function UserChatAvatar({ className, ariaLabel }: Props) {
  const snapshot = useUserProfile();
  const src = userAvatarUrl(snapshot);
  const name = userDisplayName(snapshot?.profile);
  useEffect(() => { void runUserAvatarMigration(); }, []);

  return (
    <button
      type="button"
      className={`cave-user-chat-avatar ${className ?? ""}`.trim()}
      aria-label={ariaLabel ?? "Open profile settings"}
      title="Profile settings"
      onClick={() => window.dispatchEvent(new CustomEvent("cave:open-settings", { detail: { section: "profile" } }))}
    >
      {src ? (
        <img src={src} alt="" className="cave-user-chat-avatar__image" aria-hidden="true" />
      ) : name !== "You" ? (
        <span aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>
      ) : (
        <Icon name="ph:user" width={24} height={24} aria-hidden />
      )}
    </button>
  );
}
```

  **Settings-open event:** first `grep -rn "cave:open-settings\|openSettings" src/components src/lib` for the app's existing open-settings mechanism (the shell is opened from somewhere — command menu / top bar). Use the existing mechanism with a `profile` section target instead of inventing the CustomEvent above; only fall back to the CustomEvent if a mechanism with a section parameter genuinely doesn't exist, and then wire a listener in the settings host component. Update `user-chat-avatar.test.ts` invariants to match the final mechanism (it currently asserts `useUserAvatarImage`/`setUserAvatarImage` — rewrite those to `useUserProfile`/no-inline-input).

- [ ] **Step 4: Create `src/lib/user-avatar-migrate.ts`**

```ts
"use client";

/**
 * One-time migration: legacy browser-local avatar (IndexedDB via
 * user-avatar-image.ts) → server file (POST /api/profile/avatar).
 * Runs at most once per page load, only when the server has no avatar and the
 * local store has a non-SVG one. SVG legacy avatars stay local (server rejects
 * SVG); the Settings panel invites a re-upload. The local record is cleared
 * only after the server accepted the bytes.
 */
import {
  readUserAvatarImageSnapshot, whenUserAvatarHydrated, clearUserAvatarImage,
} from "@/lib/user-avatar-image";
import {
  readUserProfileSnapshot, whenUserProfileHydrated, uploadUserProfileAvatar,
} from "@/lib/user-profile";

let attempted = false;

export async function runUserAvatarMigration(): Promise<void> {
  if (attempted || typeof window === "undefined") return;
  attempted = true;
  await Promise.all([whenUserProfileHydrated(), whenUserAvatarHydrated()]);
  const server = readUserProfileSnapshot();
  if (!server || server.avatar.present) return;
  const legacy = readUserAvatarImageSnapshot();
  if (!legacy || legacy.mime === "image/svg+xml") return;
  const res = await uploadUserProfileAvatar({ dataUrl: legacy.dataUrl, mime: legacy.mime });
  if (res.ok) await clearUserAvatarImage();
}
```

- [ ] **Step 5: Swap the "You" sites.**

  `src/components/chat-view.tsx` — add `import { useUserProfile, userDisplayName } from "@/lib/user-profile";`, read `const profileSnapshot = useUserProfile();` in the component that owns each site (check the enclosing component — both sites are inside the main `ChatView` render tree; if a site is in a non-hook helper, pass the name down as a prop or call `readUserProfileSnapshot()`):
  - Line 3829: `turn.role === "assistant" ? familiar.display_name : turn.role === "system" ? "System" : userDisplayName(profileSnapshot?.profile)`
  - Line 5624: `{turn.role === "user" ? userDisplayName(profileSnapshot?.profile) : "System"}`

  `src/components/group-chat-view.tsx` — same import; lines 390 & 475: `{ id: "__human__", name: userDisplayName(profileSnapshot?.profile), role: "", kind: "human" as const },` and the `cave-group-chat-name` span for the human turn (search `<span className="cave-group-chat-name">You</span>` — if the span already renders `p.name` from the roster entry, the roster fix covers it; verify and only change what still hard-codes "You").

  `src/lib/permissions-console.ts:229` — this is a non-React lib; change the function to accept an optional display name with a `"You"` default rather than importing the store:

```ts
// signature of the enclosing function gains: displayName = "You"
    : { label: displayName, title: `Granted by ${displayName === "You" ? "you" : displayName}` };
```

  Then update its call sites (grep `grantSourceMeta(`) to pass `userDisplayName(readUserProfileSnapshot()?.profile)` from React components; leave the existing test's `grantSourceMeta("human").label === "You"` green via the default.

  `src/lib/chat-reply.ts` — line 18 is only a doc comment; grep `chat-reply` call sites for where the author string is produced (`"You"` literal) and route it through the same helper if (and only if) a literal exists there; otherwise leave it.

- [ ] **Step 6:** Run the invariant test — PASS. Run existing suites that touch these files: `node --experimental-strip-types src/components/user-chat-avatar.test.ts src/lib/permissions-console.test.ts src/lib/group-chat.test.ts` (fix any assertion that hard-codes the old inline-upload contract). `pnpm typecheck` — clean.
- [ ] **Step 7:** Wire `src/components/user-profile-invariants.test.ts` into the `app` suite; check-tests-wired PASS.
- [ ] **Step 8:** `git add -A && git commit -S -m "feat(profile): profile-aware chat identity, server avatar, legacy migration (cave-5aw)" && git push`

---

### Task 8: Operator context for familiars

**Files:**
- Modify: `src/lib/server/familiar-startup-context.ts` (add builder)
- Modify: `src/app/api/chat/send/route.ts` (~line 1179 compute; ~line 1203 files array)
- Test: extend `src/lib/server/familiar-startup-context` coverage — create `src/lib/server/operator-profile-context.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/server/operator-profile-context.test.ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildOperatorProfileContext } from "./familiar-startup-context.ts";

describe("buildOperatorProfileContext", () => {
  it("returns null for empty profiles", () => {
    assert.equal(buildOperatorProfileContext(undefined), null);
    assert.equal(buildOperatorProfileContext({}), null);
  });
  it("renders only the set fields", () => {
    const ctx = buildOperatorProfileContext({ name: "Buns", timezone: "America/Chicago" });
    assert.ok(ctx);
    assert.equal(ctx.relativePath, "operator-profile");
    assert.match(ctx.contents, /Name: Buns/);
    assert.match(ctx.contents, /Timezone: America\/Chicago/);
    assert.doesNotMatch(ctx.contents, /Pronouns|Bio|Links/);
  });
  it("renders links as label — url lines", () => {
    const ctx = buildOperatorProfileContext({ links: [{ label: "GitHub", url: "https://github.com/x" }] });
    assert.match(ctx!.contents, /GitHub — https:\/\/github\.com\/x/);
  });
});
```

- [ ] **Step 2:** Run — FAIL.

- [ ] **Step 3: Implement in `familiar-startup-context.ts`** (append):

```ts
import type { UserProfile } from "@/lib/user-profile-shared";

/**
 * Operator profile → startup-context block. Only set fields render; an empty
 * profile yields null (zero prompt overhead). Injected on NEW sessions only —
 * resumed sessions already carry it in their history.
 */
export function buildOperatorProfileContext(
  profile: UserProfile | undefined,
): FamiliarStartupContextFile | null {
  if (!profile) return null;
  const lines: string[] = [];
  if (profile.name) lines.push(`Name: ${profile.name}`);
  if (profile.pronouns) lines.push(`Pronouns: ${profile.pronouns}`);
  if (profile.timezone) lines.push(`Timezone: ${profile.timezone}`);
  if (profile.bio) lines.push(`Bio: ${profile.bio}`);
  if (profile.links?.length) {
    lines.push("Links:");
    for (const link of profile.links) lines.push(`- ${link.label} — ${link.url}`);
  }
  if (lines.length === 0) return null;
  return {
    relativePath: "operator-profile",
    absolutePath: "operator-profile",
    contents: ["Operator profile (the human you are working with):", ...lines].join("\n"),
  };
}
```

- [ ] **Step 4: Inject in `src/app/api/chat/send/route.ts`.** Add `buildOperatorProfileContext` to the existing import from `@/lib/server/familiar-startup-context` (line ~96) and `loadConfig` is already imported in this route (verify with grep; if not, import from `@/lib/cave-config`). Next to the `dailyMemoryContext` computation (~line 1179):

```ts
  // Operator profile — who the human is. New sessions only: resumed sessions
  // already carry the block in their transcript.
  const operatorProfileContext = body.sessionId
    ? null
    : buildOperatorProfileContext((await loadConfig()).profile);
```

  Change the files array at ~line 1203 from `[dailyMemoryContext]` to:

```ts
            [operatorProfileContext, dailyMemoryContext],
```

- [ ] **Step 5:** Run the new test — PASS. `pnpm typecheck` — clean.
- [ ] **Step 6:** Wire `src/lib/server/operator-profile-context.test.ts` into the `api` suite; check-tests-wired PASS.
- [ ] **Step 7:** `git add -A && git commit -S -m "feat(profile): inject operator profile as familiar startup context (cave-5aw)" && git push`

---

### Task 9: Full verification, PR, handoff

- [ ] **Step 1:** `pnpm typecheck` — clean.
- [ ] **Step 2:** `pnpm test:app` — all pass (includes minimalism-invariants scanning new tsx: no `text-white` on accent fills; no unscoped `.reveal-on-hover`).
- [ ] **Step 3:** `pnpm test:api` — all pass.
- [ ] **Step 4:** `pnpm build` — clean production build.
- [ ] **Step 5:** Update bead: `bd update cave-5aw --notes "impl complete on feat/user-profile; typecheck+test:app+test:api+build green; PR pending"`.
- [ ] **Step 6:** `gh pr create --base main --head feat/user-profile --title "feat(profile): server-side operator profile with avatar, Settings section, and familiar context (cave-5aw)" --body "<summary of the above + spec link + verification evidence>"`.
- [ ] **Step 7:** Wait for required checks (Frontend build, Rust check, CodeQL aggregate, E2E (Playwright), Cross-environment required, Sidecar runtime required). Then `gh pr merge --squash --delete-branch`, `bd close cave-5aw --reason "merged"`, remove worktree (`git worktree remove .worktrees/feat-user-profile && git branch -D feat/user-profile`).

---

## Self-review notes

- **Spec coverage:** §1→Tasks 1-3, §2→Task 4, §3→Task 6, §4→Tasks 5+7, §5→Task 8, §6→Tasks 5 (offline fallback) + 7 (migration), §7→each task's test + Task 9. `/api/config` exclusion asserted in Task 4's test.
- **Type consistency:** `UserProfile`/`UserProfilePatch`/`ProfileLink` defined once in Task 1 and imported everywhere; `FamiliarStartupContextFile` reused from the existing module; store snapshot type `UserProfileSnapshot` used by Tasks 6-7 helpers.
- **Known judgment points for the implementer:** the Settings-open mechanism in Task 7 Step 3 (use the existing one), the exact shared field primitives in Task 6 Step 5 (read `GeneralSection` first), and whether `chat-reply.ts` actually hard-codes "You" (verify before editing).
