# Library Link Browser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a bookmark or reading-list item is selected in the library, the middle preview pane shows the page in a sandboxed iframe with a toolbar (Browser | Details tabs, Open, Copy URL).

**Architecture:** One new presentational component (`LibraryLinkBrowser`) owns the toolbar + iframe + details-tab shell. The existing `LibraryDocPreview` dispatcher decides per item whether to wrap the existing detail card in it (URL present and `isSafeHttpUrl`, and not a local-PDF reading item). No new state outside the component; remount per item via `key={item.id}`.

**Tech Stack:** Next.js / React 19 (client component), plain CSS in `src/styles/library.css`, repo-convention source-assertion tests run with `node --experimental-strip-types`.

**Spec:** `docs/superpowers/specs/2026-06-11-library-link-browser-design.md`

**Repo rules that apply to every commit in this plan:**
- Sign every commit: `git commit -S …`, then verify with `git log -1 --show-signature` (expect `Good "git" signature`).
- Work happens in the worktree created in Task 1, NOT the primary checkout (other live sessions race it).
- `docs/superpowers/` is gitignored — never `git add` the spec or this plan.

---

### Task 1: Worktree setup

**Files:** none (environment)

- [ ] **Step 1: Create the worktree**

```bash
cd /Users/buns/Documents/GitHub/OpenCoven/coven-cave
git fetch origin
git worktree add -b library-link-browser .worktrees/library-link-browser origin/main
```

Expected: `Preparing worktree (new branch 'library-link-browser')`.

- [ ] **Step 2: Install deps in the worktree**

```bash
pnpm --dir /Users/buns/Documents/GitHub/OpenCoven/coven-cave/.worktrees/library-link-browser install
```

Expected: completes in ~10s (pnpm CAS store). All subsequent paths in this plan are relative to `W=/Users/buns/Documents/GitHub/OpenCoven/coven-cave/.worktrees/library-link-browser`.

---

### Task 2: Write the failing test

**Files:**
- Test: `$W/src/components/library-link-browser.test.ts`

- [ ] **Step 1: Write the test file**

```ts
// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const browser = await readFile(new URL("./library-link-browser.tsx", import.meta.url), "utf8");
const preview = await readFile(new URL("./library-doc-preview.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../styles/library.css", import.meta.url), "utf8");

// ── Component: iframe hardening ──────────────────────────────────
assert.match(
  browser,
  /sandbox="allow-scripts allow-same-origin allow-forms allow-popups"/,
  "iframe must carry exactly the agreed sandbox allowlist",
);
assert.doesNotMatch(
  browser,
  /allow-top-navigation/,
  "framed pages must never be able to navigate the app away",
);
assert.match(
  browser,
  /referrerPolicy="no-referrer"/,
  "iframe must not leak the app origin as referrer",
);

// ── Component: toolbar tabs ──────────────────────────────────────
assert.match(browser, /role="tab"/, "toolbar should expose tabs");
assert.match(browser, />Browser</, "Browser tab label");
assert.match(browser, />Details</, "Details tab label");
assert.match(
  browser,
  /useState<Tab>\("browser"\)/,
  "Browser tab is the default",
);

// ── Integration: doc-preview gating ──────────────────────────────
const mounts = preview.match(/<LibraryLinkBrowser/g) ?? [];
assert.equal(mounts.length, 2, "browser mounts for bookmark and reading only");
assert.match(
  preview,
  /<LibraryLinkBrowser\s+key=\{item\.id\}/,
  "call sites must remount per item (key={item.id})",
);
assert.match(
  preview,
  /isSafeHttpUrl\(item\.url\)[\s\S]{0,200}<LibraryLinkBrowser/,
  "browser must be gated behind isSafeHttpUrl",
);
assert.match(
  preview,
  /isLocalPdf/,
  "reading items with a local PDF keep the PdfViewer (no iframe wrap)",
);

// ── Styles present ───────────────────────────────────────────────
for (const cls of [
  ".library-linkbrowser-toolbar",
  ".library-linkbrowser-tab--active",
  ".library-linkbrowser-stage",
  ".library-linkbrowser-hint",
  ".library-linkbrowser-frame",
]) {
  assert.ok(css.includes(cls), `library.css must define ${cls}`);
}

console.log("library-link-browser: ok");
```

- [ ] **Step 2: Run it to verify it fails**

```bash
node --experimental-strip-types $W/src/components/library-link-browser.test.ts
```

Expected: FAIL — `ENOENT … library-link-browser.tsx` (component doesn't exist yet).

---

### Task 3: The component

**Files:**
- Create: `$W/src/components/library-link-browser.tsx`

- [ ] **Step 1: Write the component**

```tsx
"use client";

import { useState, type ReactNode } from "react";
import { Icon } from "@/lib/icon";

type Tab = "browser" | "details";

type Props = {
  /** Already validated by the caller with isSafeHttpUrl. */
  url: string;
  title: string;
  /** Action buttons rendered by the caller (OpenBtn, CopyButton). */
  actions: ReactNode;
  /** The existing metadata detail card, shown on the Details tab. */
  details: ReactNode;
};

/** Embedded page view for library link items: toolbar + sandboxed iframe,
 *  with the legacy detail card one tab away. Sites that send
 *  X-Frame-Options/CSP frame-ancestors simply won't render — the hint layer
 *  behind the transparent frame and the always-visible Open button are the
 *  recovery path (no blocked-embed detection). */
export function LibraryLinkBrowser({ url, title, actions, details }: Props) {
  const [tab, setTab] = useState<Tab>("browser");
  const [loaded, setLoaded] = useState(false);
  return (
    <div className="library-preview library-linkbrowser">
      <div className="library-linkbrowser-toolbar">
        <div className="library-linkbrowser-id">
          <span className="library-linkbrowser-title">{title}</span>
          <span className="library-linkbrowser-url">{url}</span>
        </div>
        <div className="library-linkbrowser-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "browser"}
            className={`library-linkbrowser-tab${tab === "browser" ? " library-linkbrowser-tab--active" : ""}`}
            onClick={() => setTab("browser")}
          >Browser</button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "details"}
            className={`library-linkbrowser-tab${tab === "details" ? " library-linkbrowser-tab--active" : ""}`}
            onClick={() => setTab("details")}
          >Details</button>
        </div>
        <div className="library-linkbrowser-actions">{actions}</div>
      </div>
      {tab === "browser" ? (
        <div className="library-linkbrowser-stage">
          <div className="library-linkbrowser-hint" aria-hidden>
            <Icon name="ph:globe" width={28} />
            <span>
              {loaded
                ? "Some sites refuse to embed — use Open."
                : "Loading page… some sites refuse to embed; use Open if nothing appears."}
            </span>
          </div>
          <iframe
            className="library-linkbrowser-frame"
            src={url}
            title={title}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            referrerPolicy="no-referrer"
            onLoad={() => setLoaded(true)}
          />
        </div>
      ) : (
        <div className="library-linkbrowser-details">{details}</div>
      )}
    </div>
  );
}
```

Design notes the implementer must not "fix":
- No loading shimmer overlay ON TOP of the iframe: blocked embeds in some
  engines never fire `onLoad`, and an overlay keyed to it would mask the
  page forever. The hint layer sits BEHIND the transparent frame instead;
  `loaded` only swaps the hint copy.
- `details` is a prop, not an import — `BookmarkDetail`/`ReadingDetail` and
  the action buttons stay private to `library-doc-preview.tsx`.

- [ ] **Step 2: Run the test again**

```bash
node --experimental-strip-types $W/src/components/library-link-browser.test.ts
```

Expected: FAIL — now on the integration assertion (`browser mounts for bookmark and reading only`: found 0). Component assertions pass.

---

### Task 4: Dispatcher integration

**Files:**
- Modify: `$W/src/components/library-doc-preview.tsx` (imports at ~line 17, dispatcher at ~line 796)

- [ ] **Step 1: Add the import**

After the existing imports (below `import { useFocusTrap } …`):

```tsx
import { LibraryLinkBrowser } from "@/components/library-link-browser";
```

- [ ] **Step 2: Replace the bookmark/reading dispatcher branches**

In `LibraryDocPreview` (currently):

```tsx
  if (selected.kind === "bookmark") return <BookmarkDetail item={selected.item} />;
  if (selected.kind === "reading")  return <ReadingDetail item={selected.item} />;
```

becomes:

```tsx
  if (selected.kind === "bookmark") {
    const item = selected.item;
    if (item.url && isSafeHttpUrl(item.url)) {
      return (
        <LibraryLinkBrowser key={item.id} url={item.url} title={item.title}
          actions={<><OpenBtn url={item.url} /><CopyButton text={item.url} label="Copy URL" compact /></>}
          details={<BookmarkDetail item={item} />} />
      );
    }
    return <BookmarkDetail item={item} />;
  }
  if (selected.kind === "reading") {
    const item = selected.item;
    const isLocalPdf = !!item.localPath && item.localPath.toLowerCase().endsWith(".pdf");
    if (!isLocalPdf && item.url && isSafeHttpUrl(item.url)) {
      return (
        <LibraryLinkBrowser key={item.id} url={item.url} title={item.title}
          actions={<OpenBtn url={item.url} />}
          details={<ReadingDetail item={item} />} />
      );
    }
    return <ReadingDetail item={item} />;
  }
```

The `isLocalPdf` guard preserves the existing behavior where
`ReadingDetail` renders the embedded `PdfViewer` for local PDFs — the
link browser must not shadow it.

- [ ] **Step 3: Run the test again**

```bash
node --experimental-strip-types $W/src/components/library-link-browser.test.ts
```

Expected: FAIL — only on the CSS assertions (`library.css must define .library-linkbrowser-toolbar`).

---

### Task 5: Styles

**Files:**
- Modify: `$W/src/styles/library.css` (append at end of file — another session has uncommitted edits to this file in the primary checkout; appending keeps the eventual merge conflict-free)

- [ ] **Step 1: Append the styles**

```css
/* ── Link browser (embedded page view in the preview pane) ─────── */
.library-linkbrowser-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-hairline);
  flex: none;
}
.library-linkbrowser-id {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.library-linkbrowser-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.library-linkbrowser-url {
  font-size: 10px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.library-linkbrowser-tabs {
  display: flex;
  gap: 2px;
  flex: none;
  padding: 2px;
  background: var(--bg-raised);
  border: 1px solid var(--border-hairline);
  border-radius: 6px;
}
.library-linkbrowser-tab {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 4px;
  color: var(--text-secondary);
}
.library-linkbrowser-tab--active {
  background: var(--bg-base);
  color: var(--text-primary);
}
.library-linkbrowser-actions {
  display: flex;
  gap: 6px;
  flex: none;
}
.library-linkbrowser-stage {
  position: relative;
  flex: 1;
  min-height: 0;
}
.library-linkbrowser-hint {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 0 24px;
  text-align: center;
  color: var(--text-muted);
  font-size: 12px;
}
.library-linkbrowser-frame {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border: 0;
  background: transparent;
}
.library-linkbrowser-details {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: auto;
}
```

- [ ] **Step 2: Run the test — all green**

```bash
node --experimental-strip-types $W/src/components/library-link-browser.test.ts
```

Expected: PASS — `library-link-browser: ok`.

- [ ] **Step 3: Typecheck**

```bash
pnpm --dir $W run typecheck
```

Expected: exits 0.

- [ ] **Step 4: Commit (signed)**

```bash
git -C $W add src/components/library-link-browser.tsx src/components/library-link-browser.test.ts src/components/library-doc-preview.tsx src/styles/library.css
git -C $W commit -S -m "$(cat <<'EOF'
feat(library): embedded browser for link items in the preview pane

Selecting a bookmark or reading item now shows the page itself in a
sandboxed iframe with a slim toolbar (Browser | Details tabs, Open,
Copy URL). Sites that refuse framing fall back to a hint layer plus
the always-visible Open button — no blocked-embed detection. Local-PDF
reading items keep the PdfViewer; unsafe/missing URLs keep the plain
detail card.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
git -C $W log -1 --show-signature | head -3
```

Expected: `Good "git" signature` in the output. If not, STOP — do not push.

---

### Task 6: Wire the test into CI

**Files:**
- Modify: `$W/package.json` (the `test:app` script)

- [ ] **Step 1: Append the test to the `test:app` chain**

In the `"test:app"` script value, append (before the closing quote):

```
 && node --experimental-strip-types src/components/library-link-browser.test.ts
```

- [ ] **Step 2: Run the full app test chain**

```bash
pnpm --dir $W run test:app
```

Expected: every test passes; last lines include `library-link-browser: ok`.

- [ ] **Step 3: Commit (signed)**

```bash
git -C $W add package.json
git -C $W commit -S -m "$(cat <<'EOF'
test(library): wire link-browser test into test:app chain

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
git -C $W log -1 --show-signature | head -3
```

Expected: `Good "git" signature`.

---

### Task 7: Verify and hand off

- [ ] **Step 1: Signature audit**

```bash
git -C $W log origin/main..HEAD --pretty='%H %G?' | awk '$2 != "G" {print "UNSIGNED:", $0}'
```

Expected: no output.

- [ ] **Step 2: Integration decision**

Use the superpowers:finishing-a-development-branch skill. Default for this
repo: rebase on latest `origin/main`, push `HEAD:main` directly (no PR for
small UI work), then `git worktree remove` + `git branch -D` per the
project's worktree convention. Expect main to move during the work —
rebase with `--gpg-sign` and re-audit before pushing.
