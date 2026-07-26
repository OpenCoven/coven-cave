import { PALETTE_CATEGORY_LABEL, paletteCategoryForKind } from "@/lib/command-palette-search";

type PaletteGroupingRow = { id: string; kind: Parameters<typeof paletteCategoryForKind>[0] };

export function shortProjectRoot(root: string): string {
  const parts = root.replace(/\/+$/, "").split("/").filter(Boolean);
  return parts.length <= 2 ? root : `…/${parts.slice(-2).join("/")}`;
}

function browseGroup(row: PaletteGroupingRow): string {
  switch (row.kind) {
    case "session": return "Recent chats";
    case "command":
      if (row.id.startsWith("surface:")) return "Go to";
      if (row.id.startsWith("project:")) return "Projects";
      return "Commands";
    case "familiar": return "Familiars";
    case "card": return "Tasks";
    case "coven-memory":
    case "fs-memory": return "Memory";
    case "shortcut": return "Shortcuts";
    case "setting": return "Settings";
    default: return "";
  }
}

export function paletteGroup(row: PaletteGroupingRow, browsing: boolean): string {
  return browsing ? browseGroup(row) : PALETTE_CATEGORY_LABEL[paletteCategoryForKind(row.kind)];
}
