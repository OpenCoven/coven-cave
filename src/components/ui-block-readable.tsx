import "@/styles/ui-block-readable.css";

/**
 * A `coven:ui` block as plain lines, for surfaces without the native UI tier
 * (#6060). Each line is text, never markdown: nothing links, runs or sends.
 */
export function UiBlockReadable({ lines }: { lines: readonly string[] }) {
  if (lines.length === 0) return null;
  return (
    <div className="ui-block-readable" data-ui-block-readable="">
      {lines.map((line, index) => <p key={index}>{line}</p>)}
    </div>
  );
}
