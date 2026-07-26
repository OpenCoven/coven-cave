# NOTES — Skill Creator

## Provenance
Vendored verbatim from [coleam00/second-brain-skills](https://github.com/coleam00/second-brain-skills)
(`.claude/skills/skill-creator/`) at commit `75e1e9cd60ef46bffbd294fdfe4d0320cee2f563`
(fetched 2026-07-06). This is Anthropic's skill-creator skill (see the retained `LICENSE.txt`,
which its frontmatter references) as redistributed by that repo. The generated `plugin.json`
author/license fields are stamped by `scripts/sync-marketplace.py` and do not reflect upstream
authorship — `LICENSE.txt` inside the skill directory is the operative license for the skill body.

## What's vendored
The complete upstream skill: `SKILL.md`, `LICENSE.txt`, `references/` (output patterns,
workflows), and `scripts/` (`init_skill.py`, `package_skill.py`, `quick_validate.py`). Nothing
was excluded or modified.

## Runtime requirements
The bundled scripts need Python 3; `package_skill.py` produces a distributable skill archive.

## Sync integration
`skill.managed: "manual"` in `marketplace/catalog.json` — the authored SKILL.md is the source of
truth; `sync-marketplace.py` generates only the manifests and never rewrites the skill body.
Re-vendor by re-copying from upstream and updating the commit hash above.
