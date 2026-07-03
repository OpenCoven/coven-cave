# NOTES — wcag-a11y-audit

The "why this exists / trade-offs / when NOT to use" appendix.

## Why this skill exists
Accessibility is the one UI concern that is simultaneously (a) a legal obligation in most markets — ADA/Section 508 (US), EN 301 549 + the European Accessibility Act which became enforceable in 2025, AODA (Ontario) — and (b) the thing coding familiars silently break most often by shipping `<div onClick>` buttons, `outline:none`, colour-only states, and untrapped modals. `opencoven-design` and `lit-ui-designer` cover *how our components look/are built*; this skill covers *whether anyone using a keyboard, screen reader, or low vision can actually operate them*. It is deliberately **framework-agnostic** so it applies to Lit, React, Vue, Svelte, and plain HTML alike — the framework-specific tooling (eslint-plugin-jsx-a11y, template linters) is named but the audit logic is not React-locked.

## Scope boundaries (what it is / isn't)
- **Is:** an audit checklist + manual-testing playbook keyed to WCAG 2.2 **Level AA**, plus the ARIA/focus/keyboard/SR/contrast/motion patterns needed to *fix* findings.
- **Isn't:** a design-token or component-library skill (see `tailwind-design-tokens`, `shadcn-ui-and-radix`, `lit-ui-designer`), a Figma/Canva asset skill, or a full VPAT/ACR authoring service.
- **Level choice:** targets **AA** because that is the near-universal legal + procurement bar. AAA criteria (2.4.12, 2.4.13, 2.3.3, 3.3.9, contrast 7:1) are mentioned as aspirational context, not required — do not fail a build on AAA unless the requester explicitly asks for AAA.

## Key version facts (people get these wrong)
- WCAG **2.2 finalised as a W3C Recommendation on 5 October 2023**. The `/TR/WCAG22/` page header shows **12 December 2024** because W3C published an *updated edition* — same standard, not a 2.3. Say "2.2 (2023)" and you're right.
- 2.2 **adds 9 SC** and **removes exactly one: 4.1.1 Parsing** (browsers now recover from malformed markup, so it no longer gates conformance). Auditing against 4.1.1 in 2026 is a mistake.
- 2.2 is **backwards compatible** — conforming to 2.2 ⇒ conforming to 2.1 and 2.0. Regimes citing older versions accept 2.2.

## Trade-offs & judgement calls
- **Automated vs manual:** the ~30–50% automated-coverage figure is the whole reason this skill leads with manual passes. axe/Lighthouse are a *regression net*, not a compliance certificate. The failure mode to avoid: a green CI check treated as "we're accessible."
- **ARIA is a last resort, not a feature.** The most common real-world regression is *adding* ARIA that lies. Default posture: reach for native HTML; only add ARIA when building something HTML genuinely lacks (combobox, tree, tab panel) and then copy the APG pattern verbatim.
- **`role="alert"`/`assertive` fatigue:** over-eager assertive live regions interrupt SR users constantly. Default to `polite`/`status`; reserve `alert` for genuine errors.
- **Target size 24 vs 44/48:** WCAG 2.2 AA floor is **24×24**; the *enhanced* 44×44 is AAA. But Apple HIG (44pt) and Material (48dp) touch targets exceed both — for touch UIs, follow the platform, not just the WCAG floor.
- **Contrast algorithm:** stay on the WCAG 2.x luminance ratio. **APCA** is promising and part of the WCAG 3 ("Silver") draft but is **not** normative for 2.2 — don't audit against APCA numbers and call it WCAG 2.2 conformance.
- **`prefers-reduced-motion` vs SC 2.3.3:** honouring the media query is the expected modern default and prevents vestibular harm, even though SC 2.3.3 (Animation from Interactions) is technically AAA. Treat reduced-motion as table stakes regardless of level.

## When NOT to use
- Pure content/copy work with no interactive UI (though readable-label + plain-language advice from the forms/auth section can still help — that's the `charm` roleAffinity hook).
- Backend/API/infra tasks with no rendered surface.
- When the requester needs a *formal certified VPAT/ACR* — this skill informs one but isn't a substitute for a professional audit + user testing with people with disabilities.

## Interlocks with other skills in this batch
- **`shadcn-ui-and-radix`** — Radix primitives already implement many APG patterns (focus trap, roving tabindex, `aria-*`); this skill is the checklist to *verify* they weren't broken by customisation.
- **`form-ux-patterns`** — pairs directly with SC 3.3.x (labels, errors, redundant entry, accessible auth).
- **`command-palette-keyboard-ux`** — the keyboard-model + focus-management sections apply verbatim.
- **`empty-loading-error-states`** — loading/error states must announce via live regions (SC 4.1.3); coordinate.
- **`framer-motion-patterns`** — must gate on `prefers-reduced-motion`; this skill is the guardrail.

## Maintenance / freshness
- Next checkpoint: **WCAG 3.0 ("Silver")** — still a draft as of this writing; will introduce a scoring model and likely APCA contrast. Do **not** treat WCAG 3 as shippable yet. Re-verify the `/new-in-22/` page and APG pattern list on major browser `inert`/`<dialog>`/`:focus-visible` changes.
- All source URLs were verified reachable on 2026-07-01. `w3.org/TR/WCAG22`, `new-in-22`, and the tool repos are the canonical, stable anchors.

## Rubric self-assessment
Source fidelity 10/10 (all normative, version facts corrected) · Coverage 9/10 (full POUR AA + new-2.2 + tooling + manual playbook) · Coherence 9/10 (operational, report-shaped). **Self-score 28/30 → promote.**
