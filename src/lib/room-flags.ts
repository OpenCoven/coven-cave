/**
 * room-flags — which registered rooms a *build* is allowed to show.
 *
 * The Role Surface registry is deliberately open: any module can call
 * `registerRoleSurface` and its room appears (see `docs/role-surfaces.md`).
 * That is the right shape for the architecture and the wrong shape for a
 * release, because a room can be registered long before it is finished. This
 * module is the second gate — registration says a room *exists*, this says a
 * build may *show* it. Role matching still decides whether a given familiar
 * gets in; a room has to clear both.
 *
 * Production ships only the rooms that are done — the Research Desk and the
 * Chart Room. Every other room stays registered and fully workable in a dev
 * build, and joins `PRODUCTION_ROOM_IDS` when it is ready.
 *
 * Escape hatch: `NEXT_PUBLIC_CAVE_ROOMS` overrides the default for a build.
 *
 *   NEXT_PUBLIC_CAVE_ROOMS=all                    every registered room
 *   NEXT_PUBLIC_CAVE_ROOMS=researcher-desk,code   exactly those two
 *
 * The variable, when set, is the COMPLETE allowlist — it replaces the default
 * rather than adding to it, in both directions, so what a build shows is
 * always readable off one value. Ids are the registry ids in
 * `src/components/role-surfaces/ids.ts`.
 *
 * Kept free of JSX and of the component registry so the rules are unit-testable
 * under plain `node --experimental-strip-types`.
 */

import {
  CODE_SURFACE_ID,
  INDEXER_SURFACE_ID,
  MESSENGER_SURFACE_ID,
  NAVIGATOR_SURFACE_ID,
  RESEARCHER_SURFACE_ID,
  REVIEWER_SURFACE_ID,
  SCRIBE_SURFACE_ID,
  SENTINEL_SURFACE_ID,
  // Relative + extensioned, like role-surfaces.ts's own imports, so the rules
  // stay runnable under bare `node --experimental-strip-types`.
} from "../components/role-surfaces/ids.ts";

/**
 * Every room the manifest registers. Listing them here is what makes adding a
 * room a deliberate release decision: `room-flags.test.ts` fails when
 * `register.tsx` registers an id this list doesn't carry, so a new room can't
 * reach a production build just by existing.
 */
export const KNOWN_ROOM_IDS: readonly string[] = [
  RESEARCHER_SURFACE_ID,
  NAVIGATOR_SURFACE_ID,
  CODE_SURFACE_ID,
  REVIEWER_SURFACE_ID,
  SCRIBE_SURFACE_ID,
  SENTINEL_SURFACE_ID,
  MESSENGER_SURFACE_ID,
  INDEXER_SURFACE_ID,
];

/**
 * The rooms a production build shows. The rest are under construction — they
 * stay registered, stay reachable in a dev build, and move up here one at a
 * time as they land.
 */
export const PRODUCTION_ROOM_IDS: readonly string[] = [
  RESEARCHER_SURFACE_ID,
  NAVIGATOR_SURFACE_ID,
];

/** The inputs that decide room visibility for a build. */
export type RoomVisibilityEnv = {
  /** True for a production build (`NODE_ENV === "production"`). */
  production: boolean;
  /** Raw `NEXT_PUBLIC_CAVE_ROOMS`; absent/blank means "use the default". */
  rooms?: string | null | undefined;
};

/** An explicit operator override, or null when the build default applies. */
export type RoomAllowlist = { kind: "all" } | { kind: "list"; ids: ReadonlySet<string> };

/**
 * Parse `NEXT_PUBLIC_CAVE_ROOMS`. Returns null when the variable is absent or
 * blank, which means "fall back to the build default" — an operator who has
 * not spoken is not the same as one who asked for nothing.
 */
export function parseRoomsSetting(raw: string | null | undefined): RoomAllowlist | null {
  const tokens = (raw ?? "")
    .split(",")
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);
  if (tokens.length === 0) return null;
  if (tokens.includes("all") || tokens.includes("*")) return { kind: "all" };
  return { kind: "list", ids: new Set(tokens) };
}

/**
 * The visibility predicate for a build: explicit override first, then a
 * dev build (everything), then the production allowlist.
 */
export function resolveRoomVisibility(env: RoomVisibilityEnv): (roomId: string) => boolean {
  const override = parseRoomsSetting(env.rooms);
  if (override) {
    if (override.kind === "all") return () => true;
    const { ids } = override;
    return (roomId) => ids.has(roomId);
  }
  if (!env.production) return () => true;
  const shipped = new Set(PRODUCTION_ROOM_IDS);
  return (roomId) => shipped.has(roomId);
}

/** The room ids a build shows, in the order given. */
export function filterEnabledRoomIds(
  env: RoomVisibilityEnv,
  roomIds: readonly string[],
): string[] {
  const enabled = resolveRoomVisibility(env);
  return roomIds.filter(enabled);
}

/**
 * This build's environment. Both reads are literal `process.env.X` member
 * accesses on purpose — that is the only form Next inlines into the client
 * bundle, and a computed lookup would silently resolve to undefined there.
 */
export function buildRoomVisibilityEnv(): RoomVisibilityEnv {
  return {
    production: process.env.NODE_ENV === "production",
    rooms: process.env.NEXT_PUBLIC_CAVE_ROOMS,
  };
}

/**
 * Both inputs are build-time constants Next inlines into the bundle, so the
 * predicate cannot change while the app runs — resolve it once rather than
 * re-reading the env, re-splitting the setting and re-allocating a Set on
 * every call. It is called per room per render (the surface filter), and again
 * per Type chip in Familiar Studio.
 *
 * Tests exercise `resolveRoomVisibility` directly with an explicit env, which
 * is why this cache never needs a reset hook.
 */
let buildRoomVisibility: ((roomId: string) => boolean) | null = null;

/** Does this build show the room? Registration and role matching still apply. */
export function roomEnabledInBuild(roomId: string): boolean {
  buildRoomVisibility ??= resolveRoomVisibility(buildRoomVisibilityEnv());
  return buildRoomVisibility(roomId);
}
