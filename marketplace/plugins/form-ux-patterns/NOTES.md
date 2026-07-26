# NOTES — form-ux-patterns

The "why this exists / trade-offs / when NOT to use" appendix. The SKILL.md is the operational guide;
this is the reasoning and the sharp edges.

## Why this skill exists
Forms are where most apps leak conversions and fail accessibility audits. The failures are predictable
and repeat across teams: validation that fires too early, errors shown only in color or tooltips, a
disabled submit that hides *why* it's disabled, blocked paste in password fields, and hand-rolled
comboboxes with broken keyboard support. This skill encodes the current canonical stack
(react-hook-form + zod + a real label/field layer) plus the Nielsen Norman + WCAG 2.2 rules that make a
form usable, so a coding familiar can build or review one without re-deriving it every time.

## Scope boundaries (don't duplicate other plugins)
- **`shadcn-ui-and-radix` / `lit-ui-designer`:** own the *component primitives* (how a Field, Combobox, or
  Dialog is built). This skill owns *form behavior and UX* on top of those primitives.
- **`wcag-a11y-audit`:** owns the full audit checklist. Here we carry only the form-specific SC
  (3.3.1/3.3.3/3.3.7/3.3.8, plus label/grouping) as an operational subset.
- **`empty-loading-error-states`:** owns generic component states. Overlap is intentional only at
  "save-state" (Saving/Saved/Error) — defer to that skill for the broader pattern.
- **`opencoven-design` / `figma` / `canva`:** house style + asset creation, not form logic.

## Key trade-offs & judgment calls
- **Validation timing is a UX dial, not a constant.** `onTouched` is the default recommendation, but a
  short login form is fine on `onSubmit`; a password field wants `onChange`. The skill says "default to
  onTouched" and then lists when to deviate. Don't cargo-cult one mode everywhere.
- **Required vs optional is genuinely contested.** NN/g's headline advice is "mark all required fields
  (asterisk)," but their own reasoning also supports "mark only the few optional ones with '(optional)'"
  when most fields are required. The task brief leaned "(optional)"; the truth is *it depends on the
  ratio*. The skill encodes the decision tree rather than a dogma. Cite both if challenged.
- **RHF is uncontrolled-first.** That's the performance win, but it surprises people coming from
  `useState`. Controlled 3rd-party inputs need `<Controller>`; forgetting this is the #1 "my field
  won't update" bug.
- **Zod client validation is UX only.** It does not replace server validation. Say so in review.
- **Native HTML5 validation is tempting and mostly wrong for a11y.** `required`/`pattern` give you free
  hints, but the default error bubbles are inconsistent across SR/browser, auto-dismiss (~5s Chromium),
  and don't scale on zoom (Roselli). Use `noValidate` and own the messaging. The exception: a truly
  trivial, progressively-enhanced form where JS may be absent — then native is a floor, not the target.

## When NOT to use this skill
- **Non-form UI.** Buttons, menus, data tables that aren't collecting input → wrong skill.
- **You're building the component library itself** (a new Combobox primitive) → that's shadcn/Radix work.
- **Backend-only validation questions** with no UI → this is about the *human-facing* form.
- **Framework with a different idiom you're committed to** (e.g., Angular Reactive Forms, Remix/RR
  actions with progressive enhancement, HTMX server-validated forms). The *UX rules* (timing, error
  wording, a11y wiring, anti-patterns) still transfer; the *RHF/zod code* does not. Lift the principles,
  drop the imports.
- **Server-driven / no-JS forms** where uncontrolled RHF doesn't apply — keep the WCAG + microcopy parts.

## Portability note
The React-specific parts (RHF `mode`, `zodResolver`, `<Controller>`, shadcn `<Field>`) are one
implementation. The transferable core — validate-after-blur-then-live, text errors adjacent to fields,
required-in-text, allow paste, `inputmode`/`autocomplete`, focus-first-error, no reset-by-submit — is
framework-agnostic and maps onto Vue (VeeValidate/FormKit), Svelte (sveltekit-superforms), and TanStack
Form. When applying outside React, keep §3–§12 of the synthesis and swap §1–§2's code.

## Verification stance
Every URL in `plugin.json.sourceRefs` and the synthesis source list was fetched during the 2026-07-01
research run. Two facts worth re-checking on reuse because upstream moves:
1. **shadcn/ui forms live at `/docs/forms/*`** with the `<Field>` component family (this replaced the
   older single `Form` doc). If the URL 404s, check `https://ui.shadcn.com/llms.txt` for the current path.
2. **WCAG 3.3.8** names copy-paste and password managers as sufficient auth mechanisms — this is the
   citation to use when someone insists on blocking paste "for security."

## Handy Zod snippets referenced by the flow
```ts
// cross-field match (confirm password) — error lands on the confirm field
const schema = z.object({
  password: z.string().min(8, "Use at least 8 characters"),
  confirm: z.string(),
}).refine((d) => d.password === d.confirm, {
  message: "Passwords don't match",
  path: ["confirm"],
});

// coerce + constrain a currency/qty field (store minor units yourself)
z.coerce.number().positive("Enter an amount greater than 0");

// file upload validation
z.instanceof(File).refine((f) => f.size <= 5_000_000, "Max 5 MB")
  .refine((f) => ["image/png","image/jpeg"].includes(f.type), "PNG or JPEG only");
```
