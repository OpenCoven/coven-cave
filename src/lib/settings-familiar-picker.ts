export type SettingsFamiliarSearchItem = {
  id: string;
  display_name: string;
  role?: string | null;
};

export function filterSettingsFamiliars<T extends SettingsFamiliarSearchItem>(
  familiars: readonly T[],
  query: string,
): T[] {
  const tokens = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [...familiars];

  return familiars.filter((familiar) => {
    const searchable = [familiar.id, familiar.display_name, familiar.role ?? ""]
      .join(" ")
      .toLocaleLowerCase();
    return tokens.every((token) => searchable.includes(token));
  });
}

export function familiarRosterCountLabel(count: number): string {
  return `${count} ${count === 1 ? "familiar" : "familiars"}`;
}

export function moveFamiliarPickerIndex(
  current: number,
  key: "ArrowDown" | "ArrowUp",
  count: number,
): number {
  if (count <= 0) return -1;
  if (key === "ArrowDown") {
    return current < 0 || current >= count - 1 ? 0 : current + 1;
  }
  return current <= 0 || current >= count ? count - 1 : current - 1;
}
