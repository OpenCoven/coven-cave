"use client";

import {
  Fragment,
  createElement,
  type ReactNode,
} from "react";
import { parse, type Block, type TextSpan } from "@create-markdown/core";

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
      renderBlock(child, `${key}:child:${index}`)
    ),
  );
}

function renderBlock(block: Block, key: string): ReactNode {
  const children = block.children.map((child, index) =>
    renderBlock(child, `${key}:child:${index}`)
  );
  switch (block.type) {
    case "paragraph":
      return createElement("p", { key }, renderInline(block.content, key), children);
    case "heading": {
      const level = propsOf(block).level;
      const tag = typeof level === "number" && level >= 1 && level <= 6
        ? `h${level}`
        : "h2";
      return createElement(tag, { key }, renderInline(block.content, key), children);
    }
    case "bulletList":
      return createElement(
        "ul",
        { key },
        block.children.map((child, index) =>
          renderListItem(child, `${key}:item:${index}`)
        ),
      );
    case "numberedList":
      return createElement(
        "ol",
        { key },
        block.children.map((child, index) =>
          renderListItem(child, `${key}:item:${index}`)
        ),
      );
    case "checkList":
      return createElement(
        "ul",
        { key },
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
      return createElement(
        "pre",
        { key },
        createElement(
          "code",
          typeof language === "string" && language
            ? { "data-language": language }
            : null,
          block.content.map((span) => span.text).join(""),
        ),
      );
    }
    case "blockquote":
      return createElement(
        "blockquote",
        { key },
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
      return createElement(
        "table",
        { key },
        createElement(
          "thead",
          null,
          createElement(
            "tr",
            null,
            headers.map((header, index) =>
              createElement("th", { key: `${key}:header:${index}` }, header)
            ),
          ),
        ),
        createElement(
          "tbody",
          null,
          rows.map((row, rowIndex) =>
            createElement(
              "tr",
              { key: `${key}:row:${rowIndex}` },
              row.map((cell, cellIndex) =>
                createElement(
                  "td",
                  { key: `${key}:cell:${rowIndex}:${cellIndex}` },
                  cell,
                )
              ),
            )
          ),
        ),
      );
    }
    case "image": {
      const alt = propsOf(block).alt;
      return createElement(
        "p",
        { key },
        `[Image: ${typeof alt === "string" && alt.trim() ? alt : "image"}]`,
      );
    }
    case "divider":
      return createElement("hr", { key });
    case "callout": {
      const calloutType = propsOf(block).type;
      return createElement(
        "aside",
        {
          key,
          role: "note",
          "data-callout":
            typeof calloutType === "string" ? calloutType : "note",
        },
        renderInline(block.content, key),
        children,
      );
    }
  }
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
    parse(content).map((block, index) => renderBlock(block, `block:${index}`)),
  );
}
