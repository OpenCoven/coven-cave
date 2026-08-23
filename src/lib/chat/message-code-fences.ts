export type DiffLineKind = "add" | "del" | "ctx" | "meta" | "hunk";
export type DiffLine = { kind: DiffLineKind; raw: string; marker: string | null; content: string };

export function parseFenceInfo(info: string): { lang: string; filename?: string } {
  if (!info) return { lang: "text" };
  const colonIdx = info.indexOf(":");
  return colonIdx > 0
    ? { lang: info.slice(0, colonIdx).trim(), filename: info.slice(colonIdx + 1).trim() }
    : { lang: info.trim() };
}

const DIFF_META_RE =
  /^(\+\+\+ |--- |diff --git |index |new file|deleted file|rename |similarity |old mode|new mode|Binary files|\\ No newline)/;

/** Preserve diff line structure while giving syntax highlighting only code content. */
export function classifyDiffLines(code: string): DiffLine[] {
  return code.split("\n").map((raw): DiffLine => {
    if (/^@@/.test(raw)) return { kind: "hunk", raw, marker: null, content: "" };
    if (DIFF_META_RE.test(raw)) return { kind: "meta", raw, marker: null, content: "" };
    if (raw.startsWith("+")) return { kind: "add", raw, marker: "+", content: raw.slice(1) };
    if (raw.startsWith("-")) return { kind: "del", raw, marker: "-", content: raw.slice(1) };
    if (raw.startsWith(" ")) return { kind: "ctx", raw, marker: " ", content: raw.slice(1) };
    return { kind: "ctx", raw, marker: null, content: raw };
  });
}
