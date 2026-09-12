const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export function chatTitleParts(title: string): { head: string; tail: string } {
  const parts = Array.from(graphemes.segment(title), ({ segment }) => segment);
  const tailLength = Math.min(18, Math.floor(parts.length * 0.4));
  const split = parts.length - tailLength;
  return {
    head: parts.length > 52 ? `${parts.slice(0, 28).join("")}…` : parts.slice(0, split).join(""),
    tail: parts.slice(split).join(""),
  };
}
