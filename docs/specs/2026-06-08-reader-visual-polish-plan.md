# Reader Visual Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply visual polish to the coven-cave library reader modal — swap body font to Lora, widen modal to 820px, and apply airy padding throughout.

**Architecture:** All changes are CSS-only, targeting the `library-reader-*` selector block in `src/styles/library.css`. No component logic or TSX changes required. One `@import` for Google Fonts Lora is added at the top of the file.

**Tech Stack:** CSS, Google Fonts (Lora), Next.js (dev server for visual verification)

---

## Files

| File | Action |
|---|---|
| `src/styles/library.css` | Modify — 7 targeted edits to the reader block |

---

### Task 1: Import Lora font

**Files:**
- Modify: `src/styles/library.css` (top of file, after existing TODO comment ~line 6)

- [ ] **Step 1: Add the Lora @import**

Open `src/styles/library.css`. After the existing block comment at the top (ends around line 6), add:

```css
@import url('https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,600;1,400&display=swap');
```

- [ ] **Step 2: Verify import is in the right place**

The file should now read (top ~10 lines):
```css
/* TODO: light-mode-audit … */

@import url('https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,600;1,400&display=swap');

/* library.css — Research Library Phase 1 */
```

- [ ] **Step 3: Commit**

```bash
git add src/styles/library.css
git commit -m "style(reader): import Lora font from Google Fonts"
```

---

### Task 2: Widen modal to 820px

**Files:**
- Modify: `src/styles/library.css` — `.library-reader-modal` block (~line 932)

- [ ] **Step 1: Update max-width**

Find `.library-reader-modal` and change:
```css
/* before */
max-width: 780px;

/* after */
max-width: 820px;
```

- [ ] **Step 2: Verify visually**

Run dev server (`pnpm dev`) and open the library reader. The modal should be visibly wider — approximately 40px more room on each side at full viewport.

- [ ] **Step 3: Commit**

```bash
git add src/styles/library.css
git commit -m "style(reader): widen modal to 820px"
```

---

### Task 3: Airy header padding + title in Lora

**Files:**
- Modify: `src/styles/library.css` — `.library-reader-header`, `.library-reader-title`, `.library-reader-close` blocks (~lines 953–997)

- [ ] **Step 1: Update header padding**

Find `.library-reader-header` and change:
```css
/* before */
padding: 20px 24px 14px;

/* after */
padding: 28px 32px 20px;
```

- [ ] **Step 2: Update title font and size**

Find `.library-reader-title` and change:
```css
/* before */
font-size: 20px;
font-weight: 680;
color: var(--text-primary);
line-height: 1.25;
padding-right: 36px;

/* after */
font-family: 'Lora', Georgia, serif;
font-size: 22px;
font-weight: 600;
color: var(--text-primary);
line-height: 1.25;
padding-right: 40px;
```

- [ ] **Step 3: Reposition close button**

Find `.library-reader-close` and change:
```css
/* before */
top: 16px;
right: 16px;

/* after */
top: 24px;
right: 24px;
```

- [ ] **Step 4: Verify visually**

Open the reader. Header should feel spacious. Title should render in Lora (serif, slightly italic-capable) at 22px. Close button should sit comfortably in the top-right corner of the expanded header.

- [ ] **Step 5: Commit**

```bash
git add src/styles/library.css
git commit -m "style(reader): airy header padding, Lora title at 22px, reposition close btn"
```

---

### Task 4: Airy body padding + Lora prose

**Files:**
- Modify: `src/styles/library.css` — `.library-reader-body` and `.library-reader-body .cave-md.library-preview-md` blocks (~lines 1003–1015)

- [ ] **Step 1: Update body padding**

Find `.library-reader-body` and change:
```css
/* before */
padding: 32px 40px;

/* after */
padding: 44px 48px 56px;
```

- [ ] **Step 2: Apply Lora to prose**

Find `.library-reader-body .cave-md.library-preview-md` and change:
```css
/* before */
.library-reader-body .cave-md.library-preview-md {
  max-width: 100%;
  font-size: 16px;
  line-height: 1.85;
}

/* after */
.library-reader-body .cave-md.library-preview-md {
  max-width: 100%;
  font-family: 'Lora', Georgia, serif;
  font-size: 16px;
  line-height: 1.85;
}
```

- [ ] **Step 3: Verify visually**

Open the reader on a document with several paragraphs. The body should render in Lora at 16px with generous top and side padding. Content should feel like a proper reading surface, not a compact panel.

- [ ] **Step 4: Commit**

```bash
git add src/styles/library.css
git commit -m "style(reader): airy body padding, Lora at 16px/1.85 for prose"
```

---

### Task 5: Full regression check

**Files:** None modified

- [ ] **Step 1: Open library and check non-reader views**

Verify these are visually unchanged:
- Collection rail (left sidebar)
- Document list panel
- Document preview card
- Board view
- GitHub row action strips

- [ ] **Step 2: Open reader on multiple document types**

Test with:
- A short document (< 500 words)
- A long document (> 2000 words, scrollable)
- A document with headings, code blocks, and blockquotes

Verify:
- [ ] Modal opens at ~820px wide
- [ ] Title renders in Lora at 22px
- [ ] Body prose renders in Lora at 16px, line-height 1.85
- [ ] Header feels airy — no cramped edges
- [ ] Close button sits correctly in the top-right of the header
- [ ] Scrolling works correctly in the body
- [ ] Footer action bar proportions look correct

- [ ] **Step 3: Check the existing light-mode TODO comment is still present**

```bash
head -5 src/styles/library.css
```
Expected: TODO comment still visible as first line.

- [ ] **Step 4: Final commit if any minor tweaks made**

```bash
git add src/styles/library.css
git commit -m "style(reader): final regression tweaks"
```

---

## Verification Summary

| Check | Pass criteria |
|---|---|
| Modal width | Opens at 820px, not 780px |
| Title font | Lora serif, 22px, weight 600 |
| Body font | Lora serif, 16px, line-height 1.85 |
| Header padding | Noticeably more spacious than before |
| Body padding | Content has generous breathing room top/sides/bottom |
| Close button | Correctly positioned in expanded header |
| Non-reader views | No visual regressions |
| Font loads | Lora loads from Google Fonts (check Network tab) |
