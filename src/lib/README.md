# Library layout

`src/lib` keeps cross-cutting utilities at the root and groups feature-owned
modules with their tests:

- `automations/`, `board/`, `canvas/`, `chat/`, `grimoire/`, `onboarding/`,
  `projects/`, `reading/`, and `research/` contain product-domain logic.
- `familiars/`, `memory/`, `openclaw/`, `skills/`, and `tasks/` contain
  familiar and orchestration capabilities.
- `daemon/`, `github/`, `integrations/`, and `runtime/` contain runtime and
  external-system adapters.
- `hooks/`, `surfaces/`, and `themes/` contain client-facing shared behavior.
- Existing specialized directories such as `server/`, `voice/`, `flow/`, and
  `salem/` retain their established boundaries.

Add a module to an existing domain when that domain owns its behavior. Keep it
at the root only when it is genuinely shared across domains.
