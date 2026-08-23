export function newId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `id-${Math.floor(Math.random() * 1e9)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
