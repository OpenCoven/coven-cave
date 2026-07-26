---
name: opencoven-design
description: Design and implement OpenCoven surfaces against DESIGN.md and brand/ui token files, keeping interfaces dark, dense, and symbolic.
---

# OpenCoven Design Skill

Design and implement OpenCoven surfaces against DESIGN.md and brand/ui token files, keeping interfaces dark, dense, and symbolic.

## Use When
- Build a harness cockpit with left rail, dense status rows, and mono identifiers
- Apply --oc-* color and typography tokens instead of arbitrary hex or fonts
- Preserve session ritual semantics (Archive, Summon, Sacrifice) and gate destructive actions

## Guardrails
- DESIGN.md and brand/ui/*.css are the source of truth; if this skill conflicts, follow DESIGN.md
- Never use light mode as primary, random gradients, heavy glass/blur, or blue/green/red as brand accents
- Keep purple intentional, provide visible focus states, and document exceptions in docs/BRANDING-ADHERENCE.md

## Default Flow

1. Confirm the user intent and whether the action is read-only or state-changing.
2. Use the narrowest available tool scope and collect only the context needed for the task.
3. For state-changing or external actions, stop for explicit approval before acting.
4. Summarize what changed or what was learned, including relevant object IDs or links.
