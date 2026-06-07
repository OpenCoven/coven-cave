import type { LinkSource } from "./library-types";

export type FeedItem = { url: string; title: string; feedId: string; feedTitle: string };

export async function routeFeedItem(_item: FeedItem, _familiar: string): Promise<never> {
  throw new Error("not_implemented: RSS / feed adapter is v2");
}

// Type-level only: the source shape v2 will populate.
export type FeedSource = Extract<LinkSource, { kind: "feed" }>;
