import { Fragment, createElement, type ReactNode } from "react";

type ChatToolActivityLayoutProps = {
  leading: ReactNode;
  activity: ReactNode;
  content: ReactNode;
  editCards: ReactNode;
};

/**
 * Keeps live tool activity and edit cards in fixed reconciliation slots while
 * the turn content between them changes from streaming to settled.
 */
export function ChatToolActivityLayout({
  leading,
  activity,
  content,
  editCards,
}: ChatToolActivityLayoutProps) {
  return createElement(
    Fragment,
    null,
    createElement(Fragment, { key: "leading" }, leading),
    createElement(Fragment, { key: "activity" }, activity),
    createElement(Fragment, { key: "content" }, content),
    createElement(Fragment, { key: "edit-cards" }, editCards),
  );
}
