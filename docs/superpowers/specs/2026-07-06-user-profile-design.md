# User Profile — Design

**Date:** 2026-07-06
**Status:** Approved
**Scope:** Server-side operator profile (name, pronouns, bio, timezone, links) plus a server-stored profile image, editable from a new Settings → Profile section, consumed across chat surfaces and injected as operator context for familiars.

## Problem

Cave has no user profile. The human participant renders as a hard-coded `"You"` across chat (`chat-view.tsx`), group chat (`group-chat-view.tsx`), reply quotes (`chat-reply.ts`), and the permissions console (`permissions-console.ts`). The only personalization is an avatar image that is **browser-local** (IndexedDB via `src/lib/user-avatar-image.ts`, set by clicking the chat avatar), so it does not follow the operator across devices, windows, Tauri, or iOS. Familiars know nothing about who they are working with.

## Decision

Store the profile **server-side**:

- Text fields live in `~/.coven/cave-config.json` under a new optional `profile` key (existing `cave-config.ts` load/save with atomic writes).
- The profile image is a **file on disk**, not a data URL in config — `~/.coven/user-avatar.{png,jpg,webp}` — so the config JSON stays small.

Rejected alternatives: data-URL avatar inside cave-config.json (bloats a JSON read constantly), and a multi-user identity service (Cave is single-operator; YAGNI).

## 1. Data model

```ts
// cave-config.ts
export type UserProfile = {
  name?: string;        // display name, trimmed, ≤64 chars; replaces "You" when set
  pronouns?: string;    // ≤32 chars
  bio?: string;         // ≤2000 chars; shared with familiars as operator context
  timezone?: string;    // IANA id; validated with Intl.supportedValuesOf/DateTimeFormat probe
  links?: ProfileLink[]; // ≤8 entries
};
export type ProfileLink = { label: string; url: string }; // label ≤32, url http(s) only, ≤512

export type CaveConfig = { /* existing */ profile?: UserProfile };
```

Avatar file: exactly one of `user-avatar.png` / `user-avatar.jpg` / `user-avatar.webp` under `~/.coven/`; writing a new one atomically replaces and deletes the others. **SVG is not accepted** (unlike the old client-local store): the image is now served to the browser from our origin, and SVG is a stored-XSS vector.

## 2. API — `src/app/api/profile/`

- `GET /api/profile` → `{ ok: true, profile: UserProfile, avatar: { present: boolean, updatedAt?: string } }`. No image bytes.
- `PATCH /api/profile` → partial update of text fields only. Unknown keys → 400. Per-field validation (lengths, timezone probe, link URL scheme). Empty string clears a field. Returns the updated profile.
- `GET /api/profile/avatar` → image bytes, correct `Content-Type`, `ETag` derived from mtime+size (client cache-busts on change). 404 when absent.
- `POST /api/profile/avatar` → body `{ dataUrl: string, mime: string }` (matches the existing client prepare pipeline). Mime allow-list `png|jpeg|webp`; decoded size cap 2MB (reuse `MAX_FAMILIAR_IMAGE_DATAURL_BYTES` semantics). Atomic write via `writeJsonAtomic`'s sibling pattern (temp file + rename).
- `DELETE /api/profile/avatar` → removes the file; 200 either way.

`/api/config`'s `ALLOWED_TOP_LEVEL_KEYS` does **not** gain `profile` — all profile writes go through the validated `/api/profile` routes.

## 3. Settings UI

- New section `{ id: "profile", label: "Profile", icon: "ph:user-circle" }` **first** in `SETTINGS_SECTIONS` (`settings-sections.ts`), with search keywords (`name pronouns bio timezone avatar image links profile identity`).
- Panel in `settings-shell.tsx` (or a split `settings-profile.tsx` following `settings-fonts.tsx` precedent):
  - **Avatar picker** — current image (or placeholder initial), click/drag to upload with preview, Remove button. Errors (format/size/storage) inline.
  - **Name**, **Pronouns** — text inputs, save on blur (PATCH), like existing settings fields.
  - **Timezone** — select of `Intl.supportedValuesOf("timeZone")` with a "System (…)"-labelled default option; unset = system.
  - **Bio** — textarea, char counter near limit.
  - **Links** — add/remove rows of label+URL; invalid URL blocks the row save with inline reason.
- Accessibility: reuse `.focus-ring`, labelled controls, `useAnnouncer()` for save/error announcements.

## 4. Client consumption — `src/lib/user-profile.ts`

Module store mirroring `user-avatar-image.ts`:

- Fetch-once hydrate from `GET /api/profile`; in-memory snapshot; `useSyncExternalStore` hook `useUserProfile()`; `readUserProfileSnapshot()` non-hook accessor; BroadcastChannel (`cave:user-profile`) so a save in Settings updates every window.
- `userDisplayName(profile)` helper → `profile?.name?.trim() || "You"`.
- Avatar URL helper `userAvatarUrl(profile)` → `/api/profile/avatar?v=<updatedAt>` or `null`.

Call-site swaps (hard-coded `"You"` → `userDisplayName(...)`):

- `chat-view.tsx` lines ~3690 and ~5372 (turn author labels)
- `group-chat-view.tsx` — the three `{ id: "__human__", name: "You" … }` roster entries and the turn name span
- `chat-reply.ts` — quoted-author label
- `permissions-console.ts` — grant-source label (`label: "You"` stays "You" in the title-cased sentence context if name unset)

`user-chat-avatar.tsx` becomes a **display** component: renders the server avatar (fallback to initial of display name), and clicking opens Settings → Profile instead of the inline file input. `user-avatar-image.ts` remains only for the migration below, then can be retired in a follow-up.

## 5. Familiar operator context

In `/api/chat/send`, when a session **starts** (not on every turn — same gating as the existing daily-memory startup context), load the profile server-side and, if any field is set, prepend a synthetic `FamiliarStartupContextFile`:

```
relativePath: "operator-profile"
contents:
  Operator profile (the human you are working with):
  Name: …   Pronouns: …   Timezone: …
  Bio: …
  Links: label — url
```

through the existing `buildPromptWithFamiliarStartupContext` mechanism. Omit unset fields. No profile → no block (zero prompt overhead).

## 6. Migration & failure modes

- **Avatar migration (one-time, client):** on first hydrate, if `GET /api/profile` reports no avatar and the legacy IndexedDB store has one **in a supported mime (not SVG)**, POST it to the server, then clear the IndexedDB record. SVG legacy avatars are left local and the Settings panel shows a "re-upload as PNG/JPEG/WebP" hint.
- **Daemon unreachable:** Settings Profile section renders a read-only "daemon offline" state; chat falls back to `"You"` and placeholder avatar.
- **Write failures:** POST/PATCH errors surface inline with the server's reason string; the in-memory snapshot is only updated after a 2xx (persist-first, commit-after — same rule as the existing avatar store).

## 7. Testing

Wired into the hard-coded suite lists in `package.json` (CI only runs listed files; `check-tests-wired` enforces):

- `src/app/api/profile/profile-route.test.ts` — field validation (lengths, timezone, link scheme), unknown-key rejection, avatar mime/size rejection, single-file replacement, path safety (`test:api`).
- `src/lib/user-profile.test.ts` — hydrate, display-name fallback, broadcast invalidation (`test:app`).
- `src/components/settings-profile.test.ts` — section registration first in list, searchable keywords, save-on-blur wiring (`test:app`).
- Source-invariant test asserting the `"You"` call sites route through `userDisplayName` (`test:app`).

Verification: `pnpm typecheck`, targeted `node --experimental-strip-types` runs of the new tests, `pnpm test:app` / `pnpm test:api`.

## Out of scope

- iOS Settings editor (iOS will *read* name/avatar via the API in a follow-up bead).
- Retiring `user-avatar-image.ts` fully (follow-up once migration has soaked).
- Multi-operator/auth. Cave remains single-operator.
