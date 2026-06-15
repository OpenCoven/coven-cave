# Reader View Visual Polish — Design Spec
**Date:** 2026-06-08  
**Scope:** `library.css` reader modal only — no component logic changes  
**Status:** Approved for implementation

---

## Summary

Apply visual polish to the library reader modal: swap the body font to Lora, keep size at 16px, widen the modal to 820px, and give the layout generous (airy) vertical breathing room. No new interactivity, no layout restructuring — CSS-only changes to the reader section of `library.css`.

---

## Decisions Made

| Decision | Value | Notes |
|---|---|---|
| Body font | **Lora** (Google Fonts, serif) | Replaces system-ui/Inter in reader body only |
| Font size | **16px** | Unchanged from current |
| Line height | **1.85** | Unchanged |
| Max-width | **820px** | Up from 780px |
| Padding style | **Airy** | More generous vertical spacing throughout |

---

## Scope

**In scope:**
- `.library-reader-modal` — max-width 780px → 820px
- `.library-reader-header` — padding increase (airy)
- `.library-reader-title` — font-size bump (22px), Lora applied
- `.library-reader-meta` — slight spacing increase
- `.library-reader-body` — padding increase (airy), Lora font applied to prose
- `.library-reader-body .cave-md.library-preview-md` — font-family: Lora
- `.library-reader-footer` — minor padding tweak for proportion
- Google Fonts `<link>` for Lora added to the document head (or `@import` in CSS)

**Out of scope:**
- Typography system (heading scale, blockquotes, code blocks) — separate pass
- Reader controls (font size slider, theme toggle) — separate pass
- Any component/TSX changes
- Any other CSS sections outside the reader block

---

## Changes in Detail

### 1. Font import
Add to `library.css` top (after the existing TODO comment):
```css
@import url('https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,600;1,400&display=swap');
```

### 2. Modal width
```css
/* before */
max-width: 780px;

/* after */
max-width: 820px;
```

### 3. Header — airy padding
```css
/* before */
padding: 20px 24px 14px;

/* after */
padding: 28px 32px 20px;
```

### 4. Reader title — Lora + slightly larger
```css
/* before */
font-size: 20px;
font-weight: 680;

/* after */
font-family: 'Lora', Georgia, serif;
font-size: 22px;
font-weight: 600;
```

### 5. Body — airy padding + Lora
```css
/* before */
padding: 32px 40px;

/* after */
padding: 44px 48px 56px;
```

### 6. Prose font
```css
/* before */
.library-reader-body .cave-md.library-preview-md {
  max-width: 100%;
  font-size: 16px;
  line-height: 1.85;
}

/* after — add font-family */
.library-reader-body .cave-md.library-preview-md {
  max-width: 100%;
  font-family: 'Lora', Georgia, serif;
  font-size: 16px;
  line-height: 1.85;
}
```

### 7. Close button — adjust for larger header
```css
/* before */
top: 16px;
right: 16px;

/* after */
top: 24px;
right: 24px;
```

---

## Files Changed

| File | Change |
|---|---|
| `src/styles/library.css` | Font import + 6 targeted edits to reader block |

---

## Verification

- [ ] Reader modal opens at 820px wide
- [ ] Title renders in Lora at 22px
- [ ] Body prose renders in Lora at 16px, line-height 1.85
- [ ] Header and body feel airy — no cramped edges
- [ ] Close button stays correctly positioned in top-right
- [ ] No regressions to list panel, rail, doc preview, or board views
- [ ] Light-mode audit note in CSS header still present (not overwritten)
