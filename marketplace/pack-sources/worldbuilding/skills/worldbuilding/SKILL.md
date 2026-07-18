---
name: worldbuilding
description: Use for worldbuilding, story canon, a world encyclopedia, stubbing characters/settings/factions/lore, and flagging contradictions.
---

# Worldbuilding

Use this skill when the user is writing fiction, maintaining story canon, or asking
for help with a living encyclopedia of characters, settings, themes, factions, and
lore. Keep the encyclopedia small, linked, and source-grounded; the graph is the
product.

## Find the encyclopedia

Coven Cave may seed this pack into either:

- Knowledge vault collections, browsable in the Grimoire surface. Look for
  `collection.yml` under `~/.coven/knowledge/<folder>/`.
- A project folder tree. Look for `.cave/frontmatter.yml` under the project's
  world folders.

Use the location that exists. If both exist, prefer the project tree for project-
specific writing and the vault for reusable setting bibles. Do not inject the
whole encyclopedia into context; look up entries on demand.

## Behavior 1: Auto-stub on mention

When a chapter, scene, session log, note, or existing entry names a character,
place, faction, theme, or lore concept that has no page yet:

1. Create a stub in the right folder using the matching template.
2. Fill only what the source establishes.
3. Add a backlink to `[[the-source]]` in the new entry.
4. Backlink the new page from the source where the entity is first mentioned.
5. Never invent canon beyond the mention. Mark unknowns as blank or unknown.

Pick templates from `references/entity-types.md`. If an entity could fit two
folders, choose the folder that answers the active story question and mention the
ambiguity in your reply.

## Behavior 2: Flag contradictions, never silently fix

When new material contradicts existing canon, do not overwrite the old page and
do not smooth the contradiction away. Examples: a character's faction conflicts
with their action, a setting has two incompatible descriptions, or a magic rule
breaks without explanation.

Add a line to the entry's `flags:` frontmatter list, creating the list if absent:

```yaml
flags:
  - "Kael warns Duskfen (ch. 12) — contradicts Iron Pact hostility toward Duskfen"
```

Then surface the contradiction in your reply as a question: is this a mistake or
a mystery? In fiction, a contradiction is often a plot point.

## Linking and cadence

- Keep entries small and heavily `[[linked]]`.
- After a scene: update changed entries and auto-stub first mentions.
- Periodically: thread links so each entry becomes a hub, not a dead note.
- Before a reveal: pull every page touching the involved character, faction,
  setting, theme, or lore concept.
- Monthly: audit dead links and stubbed-but-never-filled pages, then propose a
  prioritized fix list.

## Guardrails

- Do not canonize speculation unless the page labels it as rumor, theory, or
  contested account.
- Do not rewrite entries wholesale when a small flag, backlink, or field update
  preserves provenance better.
- Prefer direct page lookups over bulk context dumps.
