import type { Locator, Page } from "@playwright/test";

// Chat's project and familiar filter. From 1024px it sits in the title bar, in
// the same place as the shared selectors on every other page; narrower windows
// hide that row and open the filter from the "Filter chats" button (#6478).

/** True when this viewport shows the title-bar row. */
export function chatFilterInTitleBar(page: Page): boolean {
  return (page.viewportSize()?.width ?? 0) >= 1024;
}

/** The title-bar group that holds Chat's two selectors at desktop widths. */
export function chatFilterTitleBar(page: Page): Locator {
  return page.getByRole("group", { name: "Filter chats", exact: true });
}

export type ChatFilter = {
  /** Scope that holds the "Switch project" and "Switch familiar" triggers. */
  controls: Locator;
  /** Dismisses the narrow-width popover; the title bar needs nothing. */
  close: () => Promise<void>;
};

export async function openChatFilter(page: Page): Promise<ChatFilter> {
  if (chatFilterInTitleBar(page)) {
    return { controls: chatFilterTitleBar(page), close: async () => {} };
  }
  await page.getByRole("button", { name: /^Filter chats:/ }).click();
  const dialog = page.getByRole("dialog", { name: "Filter chats", exact: true });
  return { controls: dialog, close: () => page.keyboard.press("Escape") };
}

/** The control that shows Chat's filter at All chats, at this viewport. */
export function chatFilterAtAllChats(page: Page): Locator {
  return chatFilterInTitleBar(page)
    ? chatFilterTitleBar(page).getByRole("button", { name: "Switch project: All projects", exact: true })
    // The phone chat-list sheet repeats the button while it is open.
    : page.getByRole("button", { name: "Filter chats: All chats", exact: true }).first();
}
