// Line-based diff + three-way merge for the MdEditor conflict UI.
//
// When PUT /api/memory/file returns 409 (the file changed on disk while the
// user edited), the editor shows the local draft against the disk version and
// offers keep-mine / take-theirs / merge. This module provides the pure logic:
// an LCS line diff for the visual comparison and a diff3-style merge that
// combines non-overlapping edits and marks overlapping ones with git-style
// conflict markers.
//
// Framework-free so it can be unit-tested directly.

export type LineDiffOp = { type: "add" | "del" | "ctx"; text: string };

/** Above this old×new size the LCS DP table is skipped and the whole changed
 *  middle is reported as one del/add block (prefix/suffix still align). */
const MAX_LCS_CELLS = 4_000_000;

function splitLines(text: string): string[] {
  return text === "" ? [] : text.split("\n");
}

/** Longest-common-subsequence match pairs between two line arrays, after
 *  trimming the common prefix/suffix. Falls back to no interior matches when
 *  the DP table would be too large. */
function lcsPairs(a: string[], b: string[]): Array<[number, number]> {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < start; i++) pairs.push([i, i]);

  const n = endA - start;
  const m = endB - start;
  if (n > 0 && m > 0 && n * m <= MAX_LCS_CELLS) {
    // Classic LCS length table over the changed middle, then backtrack.
    const width = m + 1;
    const table = new Uint32Array((n + 1) * width);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        table[i * width + j] =
          a[start + i] === b[start + j]
            ? table[(i + 1) * width + j + 1] + 1
            : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (a[start + i] === b[start + j]) {
        pairs.push([start + i, start + j]);
        i++;
        j++;
      } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
        i++;
      } else {
        j++;
      }
    }
  }

  for (let k = 0; endA + k < a.length; k++) pairs.push([endA + k, endB + k]);
  return pairs;
}

/** Line diff from `oldText` to `newText` as del/add/ctx ops in order. */
export function diffLines(oldText: string, newText: string): LineDiffOp[] {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  const ops: LineDiffOp[] = [];
  let ai = 0;
  let bi = 0;
  for (const [ma, mb] of lcsPairs(a, b)) {
    while (ai < ma) ops.push({ type: "del", text: a[ai++] });
    while (bi < mb) ops.push({ type: "add", text: b[bi++] });
    ops.push({ type: "ctx", text: a[ai] });
    ai++;
    bi++;
  }
  while (ai < a.length) ops.push({ type: "del", text: a[ai++] });
  while (bi < b.length) ops.push({ type: "add", text: b[bi++] });
  return ops;
}

/** True when the two texts differ (fast path for the conflict panel). */
export function hasLineChanges(ops: LineDiffOp[]): boolean {
  return ops.some((op) => op.type !== "ctx");
}

export type ThreeWayMergeResult = { text: string; conflicts: number };

export const CONFLICT_MARKER_MINE = "<<<<<<< your draft";
export const CONFLICT_MARKER_SEP = "=======";
export const CONFLICT_MARKER_THEIRS = ">>>>>>> on disk";

/**
 * diff3-style line merge of two descendants of `base`. Regions changed on only
 * one side take that side; regions changed identically on both take either;
 * overlapping different changes become a git-style conflict block (counted in
 * `conflicts`) for the user to resolve in the editor.
 */
export function mergeThreeWay(base: string, mine: string, theirs: string): ThreeWayMergeResult {
  const baseLines = splitLines(base);
  const mineLines = splitLines(mine);
  const theirsLines = splitLines(theirs);

  // base-index → matched descendant index, per side.
  const mineMap = new Map<number, number>(lcsPairs(baseLines, mineLines));
  const theirsMap = new Map<number, number>(lcsPairs(baseLines, theirsLines));

  const out: string[] = [];
  let conflicts = 0;
  let bi = 0; // base cursor
  let mi = 0; // mine cursor
  let ti = 0; // theirs cursor

  const emitChunk = (mineChunk: string[], theirsChunk: string[], baseChunk: string[]) => {
    const mineChanged =
      mineChunk.length !== baseChunk.length || mineChunk.some((l, i) => l !== baseChunk[i]);
    const theirsChanged =
      theirsChunk.length !== baseChunk.length || theirsChunk.some((l, i) => l !== baseChunk[i]);
    if (!mineChanged) {
      out.push(...theirsChunk);
    } else if (!theirsChanged) {
      out.push(...mineChunk);
    } else if (
      mineChunk.length === theirsChunk.length &&
      mineChunk.every((l, i) => l === theirsChunk[i])
    ) {
      out.push(...mineChunk);
    } else {
      conflicts++;
      out.push(CONFLICT_MARKER_MINE, ...mineChunk, CONFLICT_MARKER_SEP, ...theirsChunk, CONFLICT_MARKER_THEIRS);
    }
  };

  while (bi <= baseLines.length) {
    // A "stable" base line is one both sides kept; chunks are the spans between
    // stable lines (plus the tail past the last base line).
    const stable = bi < baseLines.length && mineMap.has(bi) && theirsMap.has(bi);
    if (stable) {
      const mm = mineMap.get(bi)!;
      const tm = theirsMap.get(bi)!;
      emitChunk(mineLines.slice(mi, mm), theirsLines.slice(ti, tm), []);
      out.push(baseLines[bi]);
      mi = mm + 1;
      ti = tm + 1;
      bi++;
      continue;
    }
    if (bi === baseLines.length) {
      emitChunk(mineLines.slice(mi), theirsLines.slice(ti), []);
      break;
    }
    // Collect the unstable base span and the descendant spans that replace it:
    // everything up to (but not including) the next stable base line.
    const chunkStart = bi;
    while (bi < baseLines.length && !(mineMap.has(bi) && theirsMap.has(bi))) bi++;
    const baseChunk = baseLines.slice(chunkStart, bi);
    const mineEnd = bi < baseLines.length ? mineMap.get(bi)! : mineLines.length;
    const theirsEnd = bi < baseLines.length ? theirsMap.get(bi)! : theirsLines.length;
    emitChunk(mineLines.slice(mi, mineEnd), theirsLines.slice(ti, theirsEnd), baseChunk);
    mi = mineEnd;
    ti = theirsEnd;
    if (bi < baseLines.length) {
      out.push(baseLines[bi]);
      mi++;
      ti++;
      bi++;
    } else {
      break;
    }
  }

  return { text: out.join("\n"), conflicts };
}
