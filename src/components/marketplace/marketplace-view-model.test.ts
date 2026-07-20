// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./marketplace-view-model.ts", import.meta.url), "utf8");

assert.match(source, /export type MarketplaceSection/, "marketplace routing sections have one shared model");
assert.match(source, /export const MARKETPLACE_SECTIONS/, "the visible tab configuration belongs to the marketplace model");
assert.match(source, /export const MARKETPLACE_SEARCH_LABEL/, "section-specific accessible search labels remain centralized");
assert.match(source, /export const MARKETPLACE_KIND_TABS/, "catalog kind filters remain stable after the hub split");
assert.match(source, /export function toSkillDetail/, "skill drawer mapping remains a focused reusable adapter");
