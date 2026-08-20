"use client";

import {
  Fragment,
  createElement,
  useState,
  type ReactNode,
} from "react";
import { parse, type Block, type TextSpan } from "@create-markdown/core";
import { copyText } from "@/lib/clipboard";
import { useAnnouncer } from "@/components/ui/live-region";

type CanonicalMemoryMarkdownProps = {
  content: string;
  mode?: "rendered" | "raw";
  className?: string;
};

function safeLink(url: string):
  | { href: string }
  | { href: string; target: "_blank"; rel: "noopener noreferrer" }
  | null {
  if (/^#[^\s]*$/.test(url)) return { href: url };
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return {
      href: parsed.href,
      target: "_blank",
      rel: "noopener noreferrer",
    };
  } catch {
    return null;
  }
}

function renderSpan(span: TextSpan, key: string): ReactNode {
  let content: ReactNode = span.text;
  if (span.styles.code) content = createElement("code", null, content);
  if (span.styles.bold) content = createElement("strong", null, content);
  if (span.styles.italic) content = createElement("em", null, content);
  if (span.styles.strikethrough) content = createElement("del", null, content);
  if (span.styles.underline) content = createElement("u", null, content);
  if (span.styles.highlight) content = createElement("mark", null, content);

  const link = span.styles.link && safeLink(span.styles.link.url);
  if (link) content = createElement("a", link, content);
  return createElement(Fragment, { key }, content);
}

function renderInline(content: TextSpan[], key: string): ReactNode[] {
  return content.map((span, index) => renderSpan(span, `${key}:span:${index}`));
}

function propsOf(block: Block): Record<string, unknown> {
  return block.props as Record<string, unknown>;
}

function renderListItem(block: Block, key: string): ReactNode {
  return createElement(
    "li",
    { key },
    renderInline(block.content, key),
    block.children.map((child, index) =>
      renderBlockNode(child, `${key}:child:${index}`)
    ),
  );
}

export function ReaderCodeBlock({
  code,
  language,
}: {
  code: string;
  language?: string;
}) {
  const { announce } = useAnnouncer();
  const [wrap, setWrap] = useState(false);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    const ok = await copyText(code);
    setCopied(ok);
    announce(ok ? "Code copied." : "Code could not be copied.", ok ? "polite" : "assertive");
    if (ok) window.setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div
      className="document-reader__code-frame document-reader__wide-block"
      data-wrap={wrap}
    >
      <div className="document-reader__code-toolbar">
        <span className="document-reader__code-language">
          {language || "Plain text"}
        </span>
        <button
          type="button"
          className="document-reader__code-action focus-ring"
          aria-label="Copy code"
          onClick={() => void copy()}
        >
          {copied ? "Copied" : "Copy"}
        </button>
        <button
          type="button"
          className="document-reader__code-action focus-ring"
          aria-label="Wrap code"
          aria-pressed={wrap}
          onClick={() => setWrap((current) => !current)}
        >
          Wrap
        </button>
      </div>
      <pre>
        <code {...(language ? { "data-language": language } : {})}>{code}</code>
      </pre>
    </div>
  );
}

export function ReaderTable({
  headers,
  rows,
}: {
  headers: string[];
  rows: string[][];
}) {
  return (
    <div
      className="document-reader__table-frame document-reader__wide-block focus-ring"
      role="region"
      aria-label="Scrollable table"
      tabIndex={0}
    >
      <table>
        <thead>
          <tr>
            {headers.map((header, index) => (
              <th key={`header:${index}`} scope="col">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={`row:${rowIndex}`}>
              {row.map((cell, cellIndex) => (
                <td key={`cell:${rowIndex}:${cellIndex}`}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function renderBlockNode(block: Block, key: string): ReactNode {
  const children = block.children.map((child, index) =>
    renderBlockNode(child, `${key}:child:${index}`)
  );
  switch (block.type) {
    case "paragraph":
      return createElement(
        "p",
        { key, className: "document-reader__paragraph" },
        renderInline(block.content, key),
        children,
      );
    case "heading": {
      const level = propsOf(block).level;
      const tag = typeof level === "number" && level >= 1 && level <= 6
        ? `h${level}`
        : "h2";
      return createElement(
        tag,
        { key, className: "document-reader__heading" },
        renderInline(block.content, key),
        children,
      );
    }
    case "bulletList":
      return createElement(
        "ul",
        { key, className: "document-reader__list document-reader__list--unordered" },
        block.children.map((child, index) =>
          renderListItem(child, `${key}:item:${index}`)
        ),
      );
    case "numberedList":
      return createElement(
        "ol",
        { key, className: "document-reader__list document-reader__list--ordered" },
        block.children.map((child, index) =>
          renderListItem(child, `${key}:item:${index}`)
        ),
      );
    case "checkList":
      return createElement(
        "ul",
        { key, className: "document-reader__list document-reader__list--tasks" },
        createElement(
          "li",
          null,
          createElement(
            "label",
            null,
            createElement("input", {
              type: "checkbox",
              checked: propsOf(block).checked === true,
              disabled: true,
              readOnly: true,
            }),
            renderInline(block.content, key),
          ),
          children,
        ),
      );
    case "codeBlock": {
      const language = propsOf(block).language;
      return createElement(ReaderCodeBlock, {
        key,
        code: block.content.map((span) => span.text).join(""),
        language: typeof language === "string" && language ? language : undefined,
      });
    }

    case "blockquote":
      return createElement(
        "blockquote",
        { key, className: "document-reader__blockquote" },
        renderInline(block.content, key),
        children,
      );
    case "table": {
      const props = propsOf(block);
      const headers = Array.isArray(props.headers)
        ? props.headers.filter((value): value is string => typeof value === "string")
        : [];
      const rows = Array.isArray(props.rows)
        ? props.rows.filter(
            (row): row is string[] =>
              Array.isArray(row) && row.every((value) => typeof value === "string"),
          )
        : [];
      return createElement(ReaderTable, { key, headers, rows });
    }
    case "image": {
      const alt = propsOf(block).alt;
      return createElement(
        "p",
        { key, className: "document-reader__paragraph" },
        `[Image: ${typeof alt === "string" && alt.trim() ? alt : "image"}]`,
      );
    }
    case "divider":
      return createElement("hr", { key, className: "document-reader__divider" });
    case "callout": {
      const calloutType = propsOf(block).type;
      return createElement(
        "aside",
        {
          key,
          role: "note",
          className: "document-reader__callout",
          "data-callout":
            typeof calloutType === "string" ? calloutType : "note",
        },
        renderInline(block.content, key),
        children,
      );
    }
  }
}

export function MarkdownReaderBlock({
  block,
  blockKey,
}: {
  block: Block;
  blockKey: string;
}) {
  return renderBlockNode(block, blockKey);
}

export function CanonicalMemoryMarkdown({
  content,
  mode = "rendered",
  className,
}: CanonicalMemoryMarkdownProps) {
  if (mode === "raw") {
    return createElement(
      "pre",
      { className },
      createElement("code", null, content),
    );
  }
  return createElement(
    "div",
    { className },
    parse(content).map((block, index) =>
      renderBlockNode(block, `block:${index}`)
    ),
  );
}
