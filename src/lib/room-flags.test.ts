import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  KNOWN_ROOM_IDS,
  PRODUCTION_ROOM_IDS,
  filterEnabledRoomIds,
  parseRoomsSetting,
  resolveRoomVisibility,
  type RoomVisibilityEnv,
} from "./room-flags.ts";
import { FAMILIAR_TYPES } from "./familiar-types.ts";
import { CODE_SURFACE_ID } from "../components/role-surfaces/ids.ts";

const CODE = CODE_SURFACE_ID;
const RESEARCH = "researcher-desk";
const CHART = "navigator-chart-room";

const repoFile = (relative: string) =>
  readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), "utf8");

const dev: RoomVisibilityEnv = { production: false };
const prod: RoomVisibilityEnv = { production: true };

test("a production build ships the Research Desk and the Chart Room, and nothing else", () => {
  assert.deepEqual([...PRODUCTION_ROOM_IDS], [RESEARCH, CHART]);
  const shown = filterEnabledRoomIds(prod, KNOWN_ROOM_IDS);
  assert.deepEqual(shown, [RESEARCH, CHART], "unfinished rooms stay out of production");
});

test("a dev build shows every registered room, including the Coding familiar's", () => {
  assert.deepEqual(filterEnabledRoomIds(dev, KNOWN_ROOM_IDS), [...KNOWN_ROOM_IDS]);
  assert.equal(resolveRoomVisibility(dev)(CODE), true, "the Coding Room is workable in dev");
  assert.equal(resolveRoomVisibility(prod)(CODE), false, "…and under construction in production");
});

test("an unset or blank NEXT_PUBLIC_CAVE_ROOMS falls back to the build default", () => {
  for (const rooms of [undefined, null, "", "   ", ",", " , ,"]) {
    assert.equal(parseRoomsSetting(rooms), null, `blank setting: ${JSON.stringify(rooms)}`);
    assert.equal(resolveRoomVisibility({ production: true, rooms })(CODE), false);
    assert.equal(resolveRoomVisibility({ production: false, rooms })(CODE), true);
  }
});

test("NEXT_PUBLIC_CAVE_ROOMS=all opens every room, in production too", () => {
  for (const rooms of ["all", "ALL", " all ", "*", "code,all"]) {
    assert.deepEqual(parseRoomsSetting(rooms), { kind: "all" }, `all setting: ${rooms}`);
    assert.deepEqual(filterEnabledRoomIds({ production: true, rooms }, KNOWN_ROOM_IDS), [
      ...KNOWN_ROOM_IDS,
    ]);
  }
});

test("an explicit list is the complete allowlist — it replaces the default both ways", () => {
  const widened: RoomVisibilityEnv = { production: true, rooms: "researcher-desk, code" };
  assert.deepEqual(filterEnabledRoomIds(widened, KNOWN_ROOM_IDS), [RESEARCH, CODE]);
  assert.equal(
    resolveRoomVisibility(widened)(CHART),
    false,
    "naming rooms drops the defaults it didn't name",
  );

  const narrowed: RoomVisibilityEnv = { production: false, rooms: "navigator-chart-room" };
  assert.deepEqual(filterEnabledRoomIds(narrowed, KNOWN_ROOM_IDS), [CHART]);
  assert.equal(resolveRoomVisibility(narrowed)(CODE), false, "a dev build can narrow too");
});

test("an unknown id opens no room rather than everything", () => {
  const env: RoomVisibilityEnv = { production: true, rooms: "not-a-room" };
  assert.deepEqual(filterEnabledRoomIds(env, KNOWN_ROOM_IDS), []);
});

test("ids are matched case-insensitively and tolerate ragged separators", () => {
  const env: RoomVisibilityEnv = { production: true, rooms: " Code ,, NAVIGATOR-CHART-ROOM ," };
  assert.deepEqual(filterEnabledRoomIds(env, KNOWN_ROOM_IDS), [CHART, CODE]);
});

// ── The lists stay honest ────────────────────────────────────────────────────

test("every room register.tsx registers is classified in KNOWN_ROOM_IDS", () => {
  const ids = repoFile("src/components/role-surfaces/ids.ts");
  const register = repoFile("src/components/role-surfaces/register.tsx");

  const constantToId = new Map<string, string>();
  for (const [, name, value] of ids.matchAll(/export const (\w+) = "([^"]+)";/g)) {
    constantToId.set(name, value);
  }
  const registered = [...register.matchAll(/registerRoleSurface\(\{\s*id: (\w+),/g)].map(
    ([, constant]) => {
      const id = constantToId.get(constant);
      assert.ok(id, `${constant} is exported from ids.ts`);
      return id;
    },
  );

  assert.ok(registered.length > 0, "register.tsx registers rooms by id constant");
  assert.deepEqual(
    [...registered].sort(),
    [...KNOWN_ROOM_IDS].sort(),
    "a new room must be classified in room-flags.ts before it can reach a build",
  );
});

test("PRODUCTION_ROOM_IDS only names rooms that exist", () => {
  for (const id of PRODUCTION_ROOM_IDS) {
    assert.ok(KNOWN_ROOM_IDS.includes(id), `${id} is a registered room`);
  }
});

test("every familiar Type points at a room that exists", () => {
  for (const spec of FAMILIAR_TYPES) {
    if (spec.roleToken == null) {
      assert.equal(spec.roomId, null, `${spec.id} unlocks no room, so it names none`);
      continue;
    }
    assert.ok(spec.roomId, `${spec.id} names the room it unlocks`);
    assert.ok(KNOWN_ROOM_IDS.includes(spec.roomId!), `${spec.id} → ${spec.roomId} is a real room`);
  }
});

test("the Studio Type picker says so when a build doesn't ship the promised room", () => {
  const picker = repoFile("src/components/familiar-studio-identity-tab.tsx");
  assert.match(
    picker,
    /if \(spec\.roomId && !roomEnabledInBuild\(spec\.roomId\)\) \{[\s\S]{0,200}?still under construction and isn't part of this build\./,
  );
  assert.match(picker, /title=\{familiarTypeHint\(t\)\}/, "the chip tooltip is honest");
  assert.match(picker, /\{familiarTypeHint\(s\)\}/, "and so is the selected-type hint");
});

// ── The Coding familiar's room stays registered ──────────────────────────────

test("the Coding familiar's room is registered for the coder role", () => {
  const register = repoFile("src/components/role-surfaces/register.tsx");
  assert.match(
    register,
    /id: CODE_SURFACE_ID,\s*role: "coder",/,
    "the Coding Desk is registered under the coder role",
  );
  assert.match(register, /render: \(context\) => <CodeRoom context=\{context\} \/>/);
  // The room answers to one name (cave-smaji) — it has carried three.
  assert.match(
    register,
    /id: CODE_SURFACE_ID,[\s\S]{0,200}?title: "Coding Desk",/,
    "the room is titled Coding Desk",
  );
  // …while its id stays the persisted `surface:code` mode the aliases resolve into.
  assert.equal(CODE_SURFACE_ID, "code", "renaming the room must not rename its stored mode");

  const types = repoFile("src/lib/familiar-types.ts");
  assert.match(
    types,
    /id: "coding",[^}]*roleToken: "coder"/,
    "the Coding familiar Type still grants the coder role token",
  );
});

// ── The gate is applied where it can't be routed around ──────────────────────

test("build visibility filters the registry at the single visibleSurfaces choke point", () => {
  const hook = repoFile("src/lib/use-role-surfaces.ts");
  assert.match(hook, /import \{ roomEnabledInBuild \} from "@\/lib\/room-flags";/);
  assert.match(
    hook,
    /listRoleSurfaces\(\)\.filter\(\(surface\) => roomEnabledInBuild\(surface\.id\)\)/,
    "rooms are filtered before role matching, so no consumer of visibleSurfaces can miss it",
  );
});

test("a room this build doesn't ship reads as under construction, not as a role mismatch", () => {
  const host = repoFile("src/components/role-surface-host.tsx");
  assert.match(host, /const shippedInBuild = surface != null && roomEnabledInBuild\(surface\.id\);/);
  assert.match(
    host,
    /if \(surface && !shippedInBuild\) \{[\s\S]{0,400}?is still under construction and isn't part of this build\./,
  );
  const constructionAt = host.indexOf("still under construction");
  const roleMismatchAt = host.indexOf("doesn't hold the ");
  assert.ok(constructionAt > 0 && roleMismatchAt > 0);
  assert.ok(
    constructionAt < roleMismatchAt,
    "the build gate answers first — a role manifest can't change its verdict",
  );
});
