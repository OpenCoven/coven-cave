---
name: form-ux-patterns
description: Use when building or reviewing web forms (sign-up, checkout, settings, listing/create flows) in React with react-hook-form + zod (or Vue/Svelte equivalents) — covers validation timing (onBlur/onChange/onSubmit/onTouched), field-level error UX and wording, required-vs-optional indicators, progressive disclosure (multi-step, accordions, show-more), input-type/keyboard selection (inputmode, autocomplete tokens), password UX (reveal toggle, strength meter, allow paste), save-state/autosave indicators, server-error surfacing back to fields, and WCAG 2.2 form accessibility (aria-invalid, aria-describedby, role="alert", fieldset/legend, SC 3.3.1/3.3.3/3.3.7/3.3.8). Flags common anti-patterns like reset-next-to-submit, disabled-submit-hiding-errors, validate-on-every-keystroke, and blocking paste in password fields.
---

# Form UX Patterns (react-hook-form + zod)

## Use When
- Building a form: sign-up/login, checkout, settings, create/edit records, marketplace listing forms.
- Reviewing a PR that adds/changes a form and you need a concrete checklist, not vibes.
- Choosing validation timing, wiring server errors back to fields, or debugging noisy/aggressive validation.
- Deciding input types, mobile keyboards (`inputmode`), and `autocomplete` tokens.
- Implementing password fields, multi-step wizards, autosave, or "unsaved changes" guards.

## Guardrails
- **Zod is the single source of truth** for shape + rules + TS type (`z.infer<typeof schema>`). Don't
  duplicate rules in JSX. Validate on the server too — client validation is UX, not security.
- **Default to `mode: "onTouched"` + `reValidateMode: "onChange"`.** Validate after the user finishes a
  field (first blur), then clear/re-check live as they fix it. Reserve `onChange` for live affordances
  (password strength). Avoid validating before a field is complete (NN/g).
- **Never rely on color, tooltips, placeholders, or a disabled button alone.** Errors must be **text**,
  next to the field, and announced (`aria-invalid` + `aria-describedby` + `role="alert"`). Placeholder ≠ label.
- **Always allow paste** in password/OTP fields; use `autocomplete="current-password" | "new-password" |
  "one-time-code"`. Blocking paste can fail WCAG 3.3.8.
- **Put "required" in text, not just an asterisk.** Cut optional fields first; if most are required, mark
  the few with literal "(optional)"; `aria-hidden` any decorative `*`.
- **Add `noValidate` on `<form>`** and control messaging yourself — native HTML5 bubbles have poor SR
  support, auto-dismiss, and don't zoom (Roselli). Keep `type`/`pattern` as hints only.
- **Never put a Reset/Clear button beside Submit.** Never disable Submit as the only error feedback —
  let it submit, then reveal errors and focus the first one (`shouldFocusError`).
- Don't ask for the same info twice in one flow — prefill or offer "same as…" (WCAG 3.3.7).

## Default Flow
1. **Model with Zod.** `const schema = z.object({...})` with per-field messages that also suggest the fix
   ("Enter an email like name@domain.com"). Cross-field rules via `.refine()/.superRefine()`. Derive
   `type Values = z.infer<typeof schema>`.
2. **Wire RHF.** `useForm<Values>({ resolver: zodResolver(schema), mode: "onTouched", defaultValues })`.
   Install `react-hook-form zod @hookform/resolvers`. Use `<Controller>` only for controlled 3rd-party
   inputs (Combobox, React-Select, date pickers).
3. **Build fields with a real label layer** — shadcn `<Field>/<FieldLabel>/<FieldError>/<FieldDescription>`
   or Radix. Each control: associated label, `aria-invalid` on error, `aria-describedby` → message,
   `role="alert"` on the message node. Group radios/related fields in `<fieldset><legend>`.
4. **Pick the narrowest input + keyboard.** `type` (email/tel/number/date/file) + `inputmode`
   (numeric/decimal/tel/email) + `autocomplete` token (given-name, email, tel, postal-code,
   one-time-code; use `section-*`/`shipping`/`billing` to disambiguate).
5. **Required/optional pass.** Remove optional fields you can. Apply the chosen convention consistently;
   ensure "required" is conveyed in text and to AT.
6. **Errors.** Field-level, adjacent, text + icon (not color-only). For long/on-submit forms add a top
   summary with anchor links (never as the only signal). On submit failure, focus first error.
7. **Passwords.** Reveal toggle (`<button aria-pressed>`), allow paste, live strength meter (`aria-live
   ="polite"`, show rules up front), `new-password`/`current-password` autofill. Confirm-match via Zod refine.
8. **Progressive disclosure.** Multi-step: per-step validation, keep data on Back, progress indicator.
   Accordions/"show more": real `<button aria-expanded>` controlling the region; never hide required
   fields. Conditional fields via `watch()`; consider `shouldUnregister`.
9. **Save state.** Disable submit only while `isSubmitting`. Autosave = debounce + `Saving…/Saved ✓/Retry`
   (aria-live). Guard navigation when `formState.isDirty`.
10. **Server errors → fields.** On a failed request, map server field errors onto RHF with
    `setError(name, { type: "server", message })` (or the `errors` prop; keep it reference-stable).
11. **Review against the anti-pattern list** (below) before you ship/approve.

## Validation timing cheat sheet
| Goal | `mode` | `reValidateMode` | Notes |
|---|---|---|---|
| Calm default | `onTouched` | `onChange` | Validate after first blur, then live-correct. Best general pick. |
| Minimal re-renders | `onSubmit` | `onChange` | Nothing until submit; corrections clear live after. |
| Live affordance (pw meter, username-free) | `onChange` (that field) | — | Justified per-keystroke; announce politely. |
| Blur-only | `onBlur` | `onBlur` | Won't re-check live; use rarely. |

## Anti-patterns to flag in review
- Reset/Clear next to Submit · Submit disabled as only error feedback · validation on every keystroke
  before field complete · blocking paste in password/OTP · placeholder-as-label · color-only errors ·
  errors in tooltips · "all fields required" banner as the only indicator · hidden password confirm /
  no reveal toggle · asking same info twice without prefill · native HTML5 bubbles as the a11y strategy ·
  `useState`-per-field re-rendering the whole form.

## Copy / microcopy
- Errors: explicit, polite, precise, constructive, and include the fix. "Enter a valid email like
  name@domain.com" > "Invalid email." Never blame the user.
- Required marker: prefer the literal word where clutter allows; "(optional)" for the rare optional field.
- Password reveal button label reflects state: "Show password" / "Hide password".

## References (verified)
- react-hook-form `useForm`: https://react-hook-form.com/docs/useform · `Controller`: https://react-hook-form.com/docs/usecontroller/controller
- zod: https://zod.dev/ · shadcn/ui Forms (RHF+Zod, `<Field>`): https://ui.shadcn.com/docs/forms/react-hook-form
- NN/g errors-in-forms: https://www.nngroup.com/articles/errors-forms-design-guidelines/ · required fields: https://www.nngroup.com/articles/required-fields/ · error-message guidelines: https://www.nngroup.com/articles/error-message-guidelines/
- Roselli, avoid default validation: https://adrianroselli.com/2019/02/avoid-default-field-validation.html
- WCAG 2.2: 3.3.1 https://www.w3.org/WAI/WCAG22/Understanding/error-identification.html · 3.3.3 https://www.w3.org/WAI/WCAG22/Understanding/error-suggestion.html · 3.3.7 https://www.w3.org/WAI/WCAG22/Understanding/redundant-entry.html · 3.3.8 https://www.w3.org/WAI/WCAG22/Understanding/accessible-authentication-minimum.html
- MDN autocomplete tokens: https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/autocomplete
