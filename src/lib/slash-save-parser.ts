export type SlashSaveOk = {
  url: string;
  listHint?: "bookmarks" | "reading" | "github";
  tags: string[];
};
export type SlashSaveResult = SlashSaveOk | { error: "url_required" };

const VALID_HINTS = new Set(["bookmarks", "reading", "github"]);

export function slashSaveParse(args: string): SlashSaveResult {
  const trimmed = (args ?? "").trim();
  if (!trimmed) return { error: "url_required" };

  const tokens = trimmed.split(/\s+/);
  const [first, ...rest] = tokens;
  let url: URL;
  try { url = new URL(first); } catch { return { error: "url_required" }; }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { error: "url_required" };

  let listHint: SlashSaveOk["listHint"];
  const tags: string[] = [];
  for (const token of rest) {
    if (token.startsWith("#")) {
      const tag = token.slice(1);
      if (tag) tags.push(tag);
    } else if (VALID_HINTS.has(token)) {
      listHint = token as SlashSaveOk["listHint"];
    }
  }

  return { url: first, listHint, tags };
}
