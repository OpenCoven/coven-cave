# Prompt packs & templates

Prompt **templates** are reusable starter prompts you drop into a composer and
edit before sending. They come from three places, merged by id (later wins):

1. **Built-ins** — `src/lib/prompt-defaults.ts`, always present, even offline.
2. **Marketplace prompt packs** — `marketplace/plugins/<pack>/prompts/*.md`,
   resolved at scan time once the pack is tracked-installed (install is
   track-only; the files ship in the repo).
3. **Your own templates** — `~/.coven/prompts/*.md`, saved from the app.

Merge precedence is **user > pack > built-in**, so you can retune a shipped
template by saving one under the same id without forking it.

## File format

One template per `.md` file. YAML frontmatter + a body that is dropped into the
composer verbatim:

```markdown
---
name: Launch release notes
description: Turn merges into benefit-led, user-facing launch notes.
icon: ph:megaphone-bold
tags:
  - release
  - writing
---

Write launch release notes for {{product|the app}} covering the changes since
{{last release|the last tag}}. Group items by user-facing area…
```

- **Filename is the id.** `release-notes-launch.md` → id `release-notes-launch`.
  Ids must be unique across every pack and the built-ins (the merge is by id).
- `name` (falls back to the id), `description`, `icon` (a Phosphor name from the
  curated set — invalid names fall back to a default glyph), and `tags` are all
  optional. Tags power the picker's filter chips and match the `/prompt` search.
- A file with frontmatter but **no body** is skipped — there is nothing to
  insert.

## Placeholders & the Tab flow

Wrap the parts to fill in as placeholders:

- `{{name}}` — a plain placeholder.
- `{{name|default}}` — a placeholder with a default value.

When you insert a template, the **first** placeholder is selected so typing
replaces it. **Tab** jumps to the next placeholder (wrapping), **Shift+Tab**
reverses, and **Tab on a selected `{{name|default}}`** accepts the default text
then jumps onward. Tab only does this while the draft still has placeholders —
once they're all filled, Tab returns to its normal focus-move behavior. Any
placeholder you don't replace stays literal, so a half-filled template is never
destructive.

## Authoring a pack

Packs are generated from the seed catalog — never hand-edit the generated files
under `marketplace/plugins/`.

1. Add a plugin entry to `marketplace/catalog.json` with a `prompts` array. Each
   entry is `{ id, name, description?, icon?, tags?, body }`:

   ```json
   {
     "name": "prompt-pack-shipping",
     "displayName": "Prompt Pack: Shipping",
     "version": "0.1.0",
     "description": "Release, review, and team-ritual prompts…",
     "category": "Productivity",
     "capabilities": ["prompts"],
     "trust": "official-local",
     "prompts": [
       {
         "id": "standup-update",
         "name": "Standup update",
         "description": "A tight daily standup: done, next, blockers.",
         "icon": "ph:chat-centered-text",
         "tags": ["team", "meeting"],
         "body": "Write my standup for {{team|the team}}. Blockers: {{blockers|none}}."
       }
     ]
   }
   ```

   Pick ids that don't collide with the built-ins or another pack. A pack whose
   only capability is `prompts` is classified as a **prompt pack** (`kind:
   "prompt"`) automatically.

2. Regenerate:

   ```bash
   python3 scripts/sync-marketplace.py
   ```

   This writes `marketplace/plugins/<pack>/prompts/<id>.md` and refreshes
   `marketplace/marketplace.json`. `serializePromptTemplate`
   (`src/lib/server/prompt-file.ts`) emits the exact same shape when a user
   saves a template from the app, so packs and user files round-trip identically
   through `scanPromptsDir`.

## How packs surface in Cave

- **Detail previews.** The marketplace detail pane lists each template as a card
  — icon, name, description, a two-line body snippet, and tag pills — fetched
  from `GET /api/marketplace/pack-prompts?id=<pack>`. That route works
  **pre-install** (read-only; the id only selects a catalog entry via the shared
  `resolveCatalogName`, and the path is built from the entry's own name).
- **Try it.** Each preview card has a ghost **Try it** that writes the template
  body into the Home composer draft and navigates Home, where the placeholder
  Tab flow picks up immediately — no install required.
- **After install.** Tracked-installed packs are merged by `/api/prompts`, so
  their templates appear in every composer's `/prompt` picker and the **Prompt
  snippets** manager alongside the built-ins and your own saved templates.

See also [`marketplace.md`](marketplace.md) for the broader catalog/sync model.
