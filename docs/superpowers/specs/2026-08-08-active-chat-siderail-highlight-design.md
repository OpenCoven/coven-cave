# Active chat siderail highlight design

## Goal

Make the active chat unmistakable in every expanded Chats siderail view without
reducing the session row's content width or changing its interaction geometry.

## Design

The live `WorkspaceSidebar` renders Recent, search-result, project-folder, and
pinned chats through two row shapes that already share `.cnav__thread.is-active`.
The row keeps its existing width, padding, controls, drag behavior, focus ring,
left accent bar, attention cues, and `aria-current` state. A positioned
`::after` pseudo-element renders the active background behind the row and
extends through the `.cnav__scroll` gutters using `--rail-pad`, while the row
content remains in its original layout.

The highlight uses the existing raised surface and semantic attention fills.
It introduces no new colors, spacing values, or behavior. The existing
`::before` accent marker stays structurally separate.

## Error handling

This is presentation-only and adds no runtime failure path. Inactive, hover,
focus, drag, and collapsed-rail behavior remain unchanged.

## Verification

A focused source-contract test must prove that the shared active class owns the
full-width pseudo-element, that each semantic attention fill carries into it,
and that the separate accent marker remains. Browser verification measures
Recent, search, project, and pinned rows against the siderail scroll edges and
confirms activation does not change row width.
