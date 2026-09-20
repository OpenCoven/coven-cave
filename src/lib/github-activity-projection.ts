import type { Card } from "./cave-board-types.ts";
import type { GitHubItem } from "./github-tasks.ts";

export function linkCardsToItems(cards: Card[], items: GitHubItem[]): Map<string, Card[]> {
  const lastItems = new Map(items.map((item) => [item.id, item]));
  const linked = new Map([...lastItems.keys()].map((id) => [id, [] as Card[]]));
  const idsByKey = new Map<string, Set<string>>();
  const key = (kind: "id" | "url", value: string) => `${kind}:${value.trim().toLowerCase()}`;
  for (const item of lastItems.values()) {
    for (const itemKey of [key("url", item.url), ...(item.id.trim() ? [key("id", item.id)] : [])]) {
      const ids = idsByKey.get(itemKey) ?? new Set<string>();
      ids.add(item.id);
      idsByKey.set(itemKey, ids);
    }
  }
  for (const card of cards) {
    const matches = new Set<string>();
    for (const github of card.github ?? []) {
      for (const itemKey of [key("url", github.url), key("id", github.id)]) {
        for (const id of idsByKey.get(itemKey) ?? []) matches.add(id);
      }
    }
    for (const id of matches) linked.get(id)?.push(card);
  }
  return linked;
}
