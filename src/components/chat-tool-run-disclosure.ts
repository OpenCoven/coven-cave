"use client";

import {
  createElement,
  type ReactNode,
} from "react";

import { useToolRunDisclosure } from "../lib/use-tool-run-disclosure.ts";

type RunStatus = "running" | "ok" | "error";

type ChatToolRunDisclosureProps = {
  repeated: boolean;
  statuses: readonly RunStatus[];
  category: string;
  ariaLabel: string;
  summary: ReactNode;
  children: ReactNode;
};

export function ChatToolRunDisclosure({
  repeated,
  statuses,
  category,
  ariaLabel,
  summary,
  children,
}: ChatToolRunDisclosureProps) {
  const disclosure = useToolRunDisclosure(statuses, repeated);

  return createElement(
    "details",
    {
      ref: disclosure.detailsRef,
      className: repeated ? "cave-tool-run" : undefined,
      "data-default-collapsed": repeated ? "true" : undefined,
      "data-tool-category": category,
      open: disclosure.open,
      onToggle: (event) => disclosure.onToggle(event.currentTarget.open),
      onBlurCapture: disclosure.onBlurCapture,
    },
    createElement(
      "summary",
      {
        className: "cave-tool-summary focus-ring",
        hidden: !repeated,
        "aria-expanded": repeated ? disclosure.open : undefined,
        "aria-label": repeated ? ariaLabel : undefined,
      },
      summary,
    ),
    createElement(
      "div",
      { className: repeated ? "cave-tool-run__list" : undefined },
      children,
    ),
  );
}
