# Knowledge Packs

A **knowledge pack** is a marketplace-distributed starter kit for a linked
knowledge base: seeded folders with entity schemas, entry templates, a bundled
agent **skill**, cadence **prompts**, and audit **workflows**. It is Coven
Cave's analogue of OpenKnowledge's starter packs — the first pack,
**Worldbuilding**, mirrors
[openknowledge.ai/docs/workflows/worldbuilding](https://openknowledge.ai/docs/workflows/worldbuilding):
characters / settings / themes / factions / lore, plus an agent that
**auto-stubs entities on mention** and **flags contradictions instead of
silently fixing them**.

## Anatomy

Packs are declared in `marketplace/catalog.json` (`kind: "knowledge-pack"`,
schema `opencoven.knowledge-pack.v1`) with authored sources under
`marketplace/pack-sources/<pack>/`:

```
marketplace/pack-sources/worldbuilding/
├── skills/worldbuilding/SKILL.md          # the agent behaviors
│   └── references/entity-types.md         # folder/template cheat-sheet
└── templates/*.md                         # 9 entity templates (frontmatter + body)
```

`scripts/sync-marketplace.py` validates the block (slug ids, template →
folder references, path-safe `sourcePath`s under `pack-sources/`, workflow
files existing) and compiles it into the generated plugin:

```
marketplace/plugins/worldbuilding/
├── plugin.json                            # marketplace manifest (kind knowledge-pack)
├── pack.json                              # compiled KnowledgePackManifest
├── templates/<id>.md                      # copied opaque bytes
├── skills/worldbuilding/**                # SKILL.md + references/, whole dir
└── prompts/<id>.md                        # standard prompt-pack files
```

`pack.json` conforms to `KnowledgePackManifest`
(`src/lib/knowledge-pack-types.ts`) — the one shape the app consumes. Never
hand-edit generated files; edit the catalog + pack-sources and re-run
`python3 scripts/sync-marketplace.py` (`--check` gates staleness in CI).

## Folders are entity types

Each pack folder declares what lives in it: `id` (slug), `name`,
`description`, a `storyQuestion` ("Who", "Where", "Why"…), an `entityType`
stamped on entries' `type:` frontmatter, `fields` (frontmatter schema:
key/label/options), and its `templates`. This is the `.ok/frontmatter.yml`
idea — the guidance lives beside the entries, not inside them.

## Seeding — `POST /api/knowledge/packs/seed`

```
GET  /api/knowledge/packs           → { ok, packs: KnowledgePackManifest[] }
POST /api/knowledge/packs/seed      body { packId, target: "vault" }
                                    or  { packId, target: "project", projectRoot, subfolder? }
                                    → { ok, target, created[], skipped[], collections? }
```

Both targets are **idempotent**: existing files are never overwritten —
they're reported in `skipped`. Seeds are recorded in
`~/.coven/cave/config.json` under `marketplace.knowledgePacks`.

### Vault target

Each folder becomes a **knowledge-vault collection**
(`~/.coven/knowledge/<folder>/`) with a `collection.yml` carrying the entity
schema and pack provenance, plus one starter stub per folder. Collections show
up in the Grimoire navigator, grouped, with the doc graph linking entries.

**Prompt-budget guard:** seeded entries are written with `enabled: false`, so
the encyclopedia is *not* wholesale-injected into every harness prompt.
Instead the `<KNOWLEDGE_VAULT>` block gains a one-line **collections index**
(from each `collection.yml` `summary`), and the pack's skill teaches agents to
look entries up on demand. Flip an individual entry to `enabled: true` to
inject it like any other vault entry.

### Project target

Seeds a folder tree into a **registered Cave project** (validated against the
projects allow-list; `subfolder` segments are slug-checked and containment is
enforced). Mirrors `ok seed --root world`:

```
your-project/world/
├── characters/           # .cave/frontmatter.yml + README.md + _templates/*.md
├── settings/ …
```

`.cave/frontmatter.yml` carries the same collection metadata; `_templates/`
holds every template for that folder so agents (and you) copy from them.

## Skill packages

A pack bundles one or more **skill packages** — a `SKILL.md` plus optional
`references/` and `scripts/` files, shipped whole inside the generated plugin.

```
POST /api/skills/packages/install   body { packId, skillId, targets? }
                                    → { ok, installedTo[] } (or alreadyInstalled)
```

Install **copies** the directory into local skill roots (`~/.coven/skills/…`,
optionally the shared agents root), where the existing skill scan, browser,
and `/skill` slash command pick it up. Copy — not symlink — matches the scan
roots' realpath dedupe and works on every platform. Uninstall via the existing
skill browser remove (`DELETE /api/skills/local`).

The worldbuilding skill teaches the two behaviors that make the pack worth it:

- **Auto-stub on mention** — new names get a stub in the right folder, from
  the right template, backlinked with `[[wiki-links]]`, never inventing canon
  beyond the mention.
- **Flag contradictions** — conflicts append to the entry's `flags:`
  frontmatter list and are surfaced as questions (mistake or mystery?), never
  silently "fixed". The Grimoire shows flag badges and a banner on flagged
  entries.

## Cadence

The pack ships four prompt templates (`update-world-encyclopedia`,
`thread-world-graph`, `pre-reveal-continuity-audit`, `world-dead-link-audit`),
a `worldbuilding-audit` workflow (`workflows/worldbuilding-audit.yaml`), and a
"Monthly world audit" automation template — mirroring the after-scene /
periodic / pre-reveal / monthly rhythm of the OpenKnowledge pack.

## Marketplace UI

The Marketplace's **Knowledge packs** tab shows pack cards; the detail view
lists folders (story question, entity type, fields), templates, the bundled
skill, prompts, and workflows. **Install & seed…** walks through target choice
(vault vs. project + subfolder, prefilled from the pack's `defaultRoot`) and
skill installation, then reports created/skipped counts.

## Authoring a new pack

1. Add a `kind: "knowledge-pack"` entry to `marketplace/catalog.json` with the
   `knowledgePack` block (folders inline; templates/skills as `sourcePath`
   references under `pack-sources/<pack>/`).
2. Author templates and the skill under `marketplace/pack-sources/<pack>/`.
3. Optionally add prompts (inline, standard prompt-pack format) and a workflow
   YAML under `workflows/`.
4. `python3 scripts/sync-marketplace.py && python3 scripts/sync-marketplace.py --check`.
