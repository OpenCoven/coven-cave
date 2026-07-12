# Worldbuilding entity types

| Folder | Entity type | Story question | Frontmatter fields | Template choice |
| --- | --- | --- | --- | --- |
| `characters` | `character` | Who? | `type`, `status`, `faction`, `firstAppearance`, `flags` | Use `character.md` for named people, creatures, recurring voices, and viewpoint entities. |
| `settings` | `setting` | Where? | `region`, `controllingFaction`, `dangerLevel`, `flags` | Use `setting.md` for places, routes, rooms, cities, wilderness, and planes. |
| `themes` | `theme` | Why? | `tension`, `flags` | Use `theme.md` for repeated moral questions, motifs, pressures, and symbolic conflicts. |
| `factions` | `faction` | Who's aligned with whom? | `type`, `alignment`, `leader`, `headquarters`, plus subtype fields | Use `faction.md` by default, `political-faction.md` for parties/states/councils, and `religion.md` for faiths or cults. |
| `lore` | `lore` | What's true about the world? | `kind`, `era`, `flags`, plus subtype fields | Use `lore.md` by default, `magic-system.md` for rules/costs/limits, and `historical-event.md` for dated causes and consequences. |
