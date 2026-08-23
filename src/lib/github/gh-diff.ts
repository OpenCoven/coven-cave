// Pure logic for rendering GitHub unified-diff hunks as structured HTML.
//
// GitHub review threads (and `\`\`\`diff` code fences in PR bodies, comments, and
// READMEs) carry raw unified-diff text. This module turns that text into
// classified, line-numbered rows so the React surface (gh-diff-view.tsx) and the
// markdown post-processor (wireDiffBlocks) can render a real reviewer-style diff
// — green additions, red deletions, hunk headers — instead of a flat `<pre>`.
//
// Framework-free so it can be unit-tested directly; the DOM helper at the bottom
// is the only browser-touching part and is guarded to be idempotent.

export type DiffLineType = "add" | "del" | "context" | "meta";

export type DiffLine = {
  type: DiffLineType;
  /** The raw line, including its leading +/-/space marker. */
  text: string;
  /** 1-based line number in the old file, or null for additions/headers. */
  oldNo: number | null;
  /** 1-based line number in the new file, or null for deletions/headers. */
  newNo: number | null;
};

const META_PREFIX =
  /^(@@|diff |index |--- |\+\+\+ |new file|deleted file|rename |similarity |old mode|new mode|Binary files)/;

/** Classify a single unified-diff line by its leading marker. */
export function classifyDiffLine(line: string): DiffLineType {
  if (META_PREFIX.test(line)) return "meta";
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "del";
  return "context";
}

/**
 * Parse a unified-diff hunk (or multi-hunk patch) into classified rows with
 * old/new line numbers tracked across `@@ -a,b +c,d @@` headers. Trailing
 * newlines are trimmed so the row count matches the visible lines.
 */
export function parseDiff(patch: string): DiffLine[] {
  const out: DiffLine[] = [];
  if (!patch) return out;
  let oldNo = 0;
  let newNo = 0;
  for (const text of patch.replace(/\n+$/, "").split("\n")) {
    const type = classifyDiffLine(text);
    if (type === "meta") {
      const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
      if (m) {
        oldNo = Number.parseInt(m[1], 10);
        newNo = Number.parseInt(m[2], 10);
      }
      out.push({ type, text, oldNo: null, newNo: null });
      continue;
    }
    if (type === "add") {
      out.push({ type, text, oldNo: null, newNo: newNo++ });
    } else if (type === "del") {
      out.push({ type, text, oldNo: oldNo++, newNo: null });
    } else {
      out.push({ type, text, oldNo: oldNo++, newNo: newNo++ });
    }
  }
  return out;
}

/** Count added/removed lines in a parsed diff (for the `+a −b` summary chip). */
export function diffStats(lines: DiffLine[]): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const l of lines) {
    if (l.type === "add") additions += 1;
    else if (l.type === "del") deletions += 1;
  }
  return { additions, deletions };
}

const DIFF_LINE_CLASS: Record<DiffLineType, string> = {
  add: "gh-diff__line gh-diff__line--add",
  del: "gh-diff__line gh-diff__line--del",
  context: "gh-diff__line gh-diff__line--ctx",
  meta: "gh-diff__line gh-diff__line--meta",
};

/** CSS class for a diff row of the given type. */
export function diffLineClass(type: DiffLineType): string {
  return DIFF_LINE_CLASS[type];
}

/**
 * Post-process rendered markdown: turn every `\`\`\`diff` fenced block
 * (`<code class="language-diff">`) into a colorized, line-classified diff. Each
 * line becomes a `<span class="gh-diff__line gh-diff__line--*">`, and the parent
 * `<pre>` gains the `gh-diff` class so the same stylesheet drives both surfaces.
 *
 * Idempotent: a processed block is tagged `data-gh-diff-wired` and skipped on
 * re-runs, so it composes with the markdown MutationObserver without looping.
 */
export function wireDiffBlocks(container: HTMLElement): void {
  if (typeof document === "undefined") return;
  const blocks = container.querySelectorAll<HTMLElement>('code[class*="language-diff"]');
  blocks.forEach((code) => {
    if (code.dataset.ghDiffWired === "1") return;
    code.dataset.ghDiffWired = "1";
    const lines = parseDiff(code.textContent ?? "");
    if (lines.length === 0) return;
    const frag = document.createDocumentFragment();
    for (const line of lines) {
      const span = document.createElement("span");
      span.className = diffLineClass(line.type);
      // Keep blank lines visible (zero-width space) so the row keeps its height.
      span.textContent = line.text.length > 0 ? line.text : "​";
      frag.appendChild(span);
    }
    code.replaceChildren(frag);
    const pre = code.closest("pre");
    if (pre) {
      pre.classList.add("gh-diff", "gh-diff--md");
      pre.dataset.ghDiff = "1";
    }
  });
}
