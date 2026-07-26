---
name: lit-ui-designer
description: Inspect existing components and conventions first, define the UX contract, then implement idiomatic Lit with native semantics, polished states, and verified accessibility.
---

# Lit UI Designer

Inspect existing components and conventions first, define the UX contract, then implement idiomatic Lit with native semantics, polished states, and verified accessibility.

## Use When
- Build a Lit custom element with public props as API, private @state internals, and composed bubbling events
- Review a component for blocking accessibility, web-component architecture, and visual craft issues in priority order
- Design loading, empty, error, disabled, and focus states with CSS custom properties for theming

## Guardrails
- Prefer native HTML semantics before ARIA, and follow WAI-ARIA APG exactly when a complex widget needs roles
- Avoid dynamic style blocks and unsafeCSS unless the value is fully trusted with no safer token option
- Target WCAG 2.2 AA: visible focus indicators, accessible names for icon-only controls, and prefers-reduced-motion support

## Default Flow

1. Confirm the user intent and whether the action is read-only or state-changing.
2. Use the narrowest available tool scope and collect only the context needed for the task.
3. For state-changing or external actions, stop for explicit approval before acting.
4. Summarize what changed or what was learned, including relevant object IDs or links.
