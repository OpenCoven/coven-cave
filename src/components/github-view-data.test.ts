import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./github-view-data.ts", import.meta.url), "utf8");
assert.match(source, /export function useFamiliars/, "GitHub familiar loading has a dedicated data boundary");
assert.match(source, /export function useCards/, "linked board-card loading has a dedicated data boundary");
assert.match(source, /export const KIND_ORDER/, "GitHub activity ordering remains centralized");
assert.match(source, /export function linkedCardsForItem/, "task linking preserves URL and id matching");
