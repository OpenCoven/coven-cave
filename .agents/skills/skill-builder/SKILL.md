---
name: skill-builder
description: Use when asked to build, author, draft, or save a Coven Cave skill (a SKILL.md familiars load), or when a chat brief carries the skills build API contract. Trigger on "build a skill", "write a SKILL.md", "author a skill for", "turn this procedure into a skill", or a brief naming POST /api/skills/build.
---

# Skill Builder

A Cave skill is a `SKILL.md` — YAML frontmatter (`name`, `description`,
optional `tags`) plus terse markdown instructions — that familiars load while
they work. The frontmatter `description` is the **trigger**: an agent reading
only the name + description must know exactly when to load the skill. Your job
in a build chat: draft the skill **with** the operator, then save it through
the local Cave API.

## The build loop

All endpoints are loopback HTTP on the machine running Cave (no auth). Use
`curl` against the running app (ports 3000–3010 in dev; the desktop app serves
the same routes).

1. **Check what exists**

   ```bash
   curl -s http://127.0.0.1:3000/api/skills/local
   ```

   → installed skills across the local roots. Don't duplicate a slug, and
   don't author a trigger that collides with one that already fires.

2. **Draft with the operator** — name (a few words), the one-line trigger
   `description` (name the situations and cue phrases), 0–6 lowercase tags,
   and imperative instructions with `## ` sections (When to use / Steps /
   Verification). Iterate until they approve.

3. **Save it**

   ```bash
   curl -s -X POST http://127.0.0.1:3000/api/skills/build \
     -H 'content-type: application/json' \
     -d '{"name":"…","description":"…","instructions":"…","root":"coven","tags":["…"]}'
   ```

   → `{ ok, slug, path }`. The file lands at `<root>/<slug>/SKILL.md` and is
   immediately visible in the Skills tab.

4. **Prove it fires (optional but recommended)**

   ```bash
   curl -s -X POST http://127.0.0.1:3000/api/skills/dry-run \
     -H 'content-type: application/json' \
     -d '{"mode":"trigger","name":"…","description":"…","scenario":"…"}'
   ```

   → `{ ok, fires, reason }`. A `no` verdict means the description needs
   sharper cue phrases — fix it with the operator before calling it done.

5. **Report back** — the written path, the slug, and the trigger description
   you settled on.

## Contract notes

- **Creation-only:** a duplicate slug is refused with `code: "exists"` (409)
  — pick a new name rather than overwriting.
- The slug is derived server-side from the name (lowercase kebab); you don't
  pick ids.
- Roots: `coven` → `~/.coven/skills` (every familiar), `claude` →
  `~/.claude/skills`, `codex` → `~/.codex/skills`, `agents` →
  `~/.agents/skills`. Default to `coven` unless the operator says otherwise.
- Caps: name 80 chars, description 500 chars, instructions 64 KB, tags 12.
- Only save what the operator approved.
