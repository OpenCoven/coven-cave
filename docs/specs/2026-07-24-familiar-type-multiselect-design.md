# Familiar Type multiselect

**Date:** 2026-07-24
**Status:** Approved
**Surface:** Familiar Studio → Identity → Type picker

## Problem

A familiar's Type (cave-cc5r) is single-select: picking Research replaces
Coding. Types are purely *additive* role grants — each one unlocks a Role
Surface room and never subtracts anything — so there is no semantic reason a
familiar can't be both a Coding and a Research familiar. The single-select
picker is an artificial cap.

## Design

### Storage: comma-separated ids in the existing field

The stored value stays a single string — `familiarType?: string` — now
encoded as comma-separated type ids, e.g. `"coding,research"`. A single
selection keeps its exact current encoding (`"coding"`). An absent/empty
field still means General; an *explicit* return to General stores the
literal `"general"` sentinel (see UI section — an empty string would merely
clear the override and let a daemon-provided base type resurface).

Why: the field flows through five layers (`FamiliarOverride` →
`ConfigPatch` (`string | null`) → cave-config → daemon → `Familiar` /
`familiar-resolve`), all typed `string`. Comma encoding means **zero schema
churn** across that chain — only the two endpoints (the parser in
`familiar-types.ts` and the picker UI) change. Existing stored single values
parse unchanged; no migration.

### Parsing: `parseFamiliarTypeIds`

New function in `src/lib/familiar-types.ts`:

```ts
parseFamiliarTypeIds(value: string | undefined | null): FamiliarTypeId[]
```

- Split on `,`, trim + lowercase each token.
- Keep only tokens where `isFamiliarTypeId` holds; unknown/stale ids are
  silently dropped (same degrade-to-General spirit as today's
  `resolveFamiliarType` fallback).
- `"general"` never appears in the result — General is the *empty state*,
  not a member type.
- Dedupe, preserving first-occurrence order.
- `undefined` / `null` / `""` → `[]`.

`resolveFamiliarTypes(value): FamiliarTypeSpec[]` maps parsed ids to table
entries (`[]` means General). `resolveFamiliarType` (singular) remains for
single-value semantics: first parsed type's spec, else General — so
`resolveFamiliarType("coding,research").id === "coding"` and all existing
single-value behavior (case/whitespace tolerance, unknown → General) is
unchanged.

### Grants: union

`familiarTypeRoleIds(value)` unions grants across every parsed type: for each
spec it contributes `[spec.id, spec.roleToken]`, deduped, in parse order.
`"coding,research"` → `["coding", "coder", "research", "researcher"]`.
Empty/General → `[]` exactly as today. `role-surfaces.ts` needs **no
change** — it already spreads this list into the grant set.

### UI: checkbox chips, General as the empty state

`FamiliarTypePicker` in `familiar-studio-identity-tab.tsx`:

- The chip row becomes a checkbox group: container `role="group"`
  (aria-labelledby unchanged), each chip `role="checkbox"` +
  `aria-checked` by membership. Same `.familiar-studio-type-chip` /
  `--active` classes — no CSS changes.
- Clicking a type chip **toggles** it in the selection. The stored value is
  the selected ids comma-joined in `FAMILIAR_TYPES` table order (stable,
  canonical); an empty selection stores the `"general"` sentinel.
- **General chip = empty state**: `aria-checked` only when no types are
  selected; clicking it stores `familiarType: "general"`. Deselecting the
  last type likewise stores the sentinel. The sentinel — rather than `""` —
  is required because `configPatchForOverridePatch` maps empty strings to a
  clearing `null`, which only deletes the override and lets a
  daemon-provided base type win again on resolve
  (`ov.familiarType ?? base.familiarType`); the parser already treats
  `"general"` as the empty selection. General and real types are mutually
  exclusive by construction.
- Every chip click announces the resulting selection via `useAnnouncer()`
  ("Type set to General" / "Type set to <labels>"), since toggling a type
  also flips `aria-checked` on the non-focused General chip.
- **Hint text (stacked)**: with types selected, render one
  `<p className="familiar-studio-identity__hint">` per selected type, each
  showing that type's unlock description (table order). Empty selection
  renders General's description — identical to today. Single selection
  renders identically to today.

### Non-goals

- No changes to the daemon, cave-config schema, `/api/familiars`, or
  `familiar-resolve` — the string passes through untouched.
- No cap on selections (all eight types may be active; grants are additive
  room unlocks).
- No reordering UI — canonical order is the table order.

## Testing

- `src/lib/familiar-types.test.ts`: parse (multi, whitespace/case, dedupe,
  unknown-dropped, general-excluded, empty/null), union grants, singular
  resolve-first behavior.
- `src/lib/role-surfaces.test.ts`: multi-type familiar gets both rooms'
  grant ids.
- `src/components/familiar-studio-identity-tab.test.ts`: source pins for
  `role="checkbox"`, `parseFamiliarTypeIds` usage, and the
  `familiarType: "general"` sentinel store.

All three run in the app suite (`node scripts/run-tests.mjs app`).
