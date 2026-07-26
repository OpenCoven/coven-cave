# NOTES — SOP & Runbook Creator

## Provenance
Vendored verbatim from [coleam00/second-brain-skills](https://github.com/coleam00/second-brain-skills)
(`.claude/skills/sop-creator/`) at commit `75e1e9cd60ef46bffbd294fdfe4d0320cee2f563`
(fetched 2026-07-06). Authored by Cole Medin (coleam00); the generated `plugin.json` author/license
fields are stamped by `scripts/sync-marketplace.py` and do not reflect upstream authorship.

## What's vendored
The complete upstream skill: `SKILL.md` plus `references/` templates for each documentation
format — runbook, standard SOP, how-to guide, onboarding guide, checklist, decision tree, and a
combined templates file. Nothing was excluded or modified.

## Sync integration
`skill.managed: "manual"` in `marketplace/catalog.json` — the authored SKILL.md is the source of
truth; `sync-marketplace.py` generates only the manifests and never rewrites the skill body.
Re-vendor by re-copying from upstream and updating the commit hash above.
