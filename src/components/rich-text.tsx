import { Fragment, type ReactNode } from "react";

/**
 * Tiny markdown-ish renderer: turns `inline code` spans into <code> pills and
 * preserves whitespace. Avoid pulling in a full markdown lib for this surface;
 * the underlying CLI emits mostly plain text + the occasional backtick span.
 */
export function RichText({ text }: { text: string }) {
  if (!text) return null;
  const nodes: ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < text.length) {
    const tick = text.indexOf("`", i);
    if (tick < 0) {
      nodes.push(<Fragment key={key++}>{text.slice(i)}</Fragment>);
      break;
    }
    if (tick > i) nodes.push(<Fragment key={key++}>{text.slice(i, tick)}</Fragment>);
    const close = text.indexOf("`", tick + 1);
    if (close < 0) {
      // Unterminated — show the rest verbatim
      nodes.push(<Fragment key={key++}>{text.slice(tick)}</Fragment>);
      break;
    }
    const code = text.slice(tick + 1, close);
    nodes.push(
      <code
        key={key++}
        className="rounded bg-[var(--bg-raised)]/80 px-1.5 py-0.5 font-mono text-[12px] text-[var(--text-primary)]"
      >
        {code}
      </code>,
    );
    i = close + 1;
  }
  return <span className="whitespace-pre-wrap break-words">{nodes}</span>;
}
