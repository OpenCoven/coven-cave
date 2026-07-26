# NOTES — Remotion Video

## Provenance
Vendored from [coleam00/second-brain-skills](https://github.com/coleam00/second-brain-skills)
(`.claude/skills/remotion/`) at commit `75e1e9cd60ef46bffbd294fdfe4d0320cee2f563`
(fetched 2026-07-06). The rules library originates from Remotion's own agent guidance
(remotion.dev); packaged for second-brain-skills by Cole Medin (coleam00). The generated
`plugin.json` author/license fields are stamped by `scripts/sync-marketplace.py` and do not
reflect upstream authorship.

## What's vendored
The complete upstream skill: the skill entry file plus `rules/` — ~30 topic files (timing,
sequencing, compositions, assets, audio, captions, charts, 3D, Lottie, maps, Tailwind, Mediabunny
media probing) and `rules/assets/` ready-made text-animation/chart components.

One rename: upstream ships the entry file as lowercase `skill.md`; it is `SKILL.md` here to match
the marketplace pack layout. Content is unmodified — frontmatter keeps the upstream skill name
`remotion-best-practices`.

## Sync integration
`skill.managed: "manual"` in `marketplace/catalog.json` — the authored SKILL.md is the source of
truth; `sync-marketplace.py` generates only the manifests and never rewrites the skill body.
Re-vendor by re-copying from upstream (re-applying the rename) and updating the commit hash above.
