import { splitHiddenUnicode, type HiddenUnicodeKind } from "@/lib/hidden-unicode";
import "@/styles/hidden-unicode.css";

/**
 * A file, branch or session name with its hidden characters shown as code
 * points (#5781): a right-to-left override can't flip the rest of the name,
 * and a zero-width space can't make two names look alike. Plain names render
 * as plain text, with no extra elements.
 */
export function HiddenUnicodeText({ text, kind = "name" }: { text: string; kind?: HiddenUnicodeKind }) {
  const segments = splitHiddenUnicode(text, kind);
  if (segments.length === 1 && !segments[0].hidden) return <>{text}</>;
  if (segments.length === 0) return null;
  return (
    <>
      {segments.map((segment, index) =>
        segment.hidden ? (
          <span key={index} className="cave-hidden-char" data-cp={segment.label}>
            {segment.text}
          </span>
        ) : (
          segment.text
        ),
      )}
    </>
  );
}
