import { NextResponse } from "next/server.js";

import type { ResearchMissionActionInput } from "@/lib/research-missions";
import {
  XApiError,
  parseXPostUrl,
  type NormalizedXPost,
  type XScope,
} from "@/lib/x-api";
import { readJsonBody, rejectNonLocalRequest, type JsonBodyResult } from "@/lib/server/api-security";
import { isValidFamiliarId } from "@/lib/server/familiar-id";
import { makeProductionResearchMissionRunner } from "@/lib/server/research-mission-runner";
import {
  isValidResearchMissionId,
  listResearchMissions,
  loadResearchMission,
} from "@/lib/server/research-mission-store";
import {
  getCachedXPost,
  listSavedXSources,
  markXPostAvailability,
  reconcileXSourceMissionAttachments,
  refreshSavedXSourceFromPost,
  removeSavedXSource,
  saveCachedXPostAsSource,
  setXSourceMissionAttached,
  sweepExpiredXCache,
  type SavedXSource,
  type SaveCachedXPostAsSourceInput,
  withXSourceLifecycleLock,
} from "@/lib/server/x-sources";
import {
  requireXCapability,
  toXErrorResponse,
  withXAuthenticatedRead,
} from "@/lib/server/x-access";
import { lookupXPost } from "@/lib/server/x-client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 16 * 1024;
const MAX_URL_CHARS = 2_048;
const MAX_NOTE_CHARS = 2_000;
const MAX_TAGS = 25;
const MAX_TAG_CHARS = 64;
const MAX_SOURCE_ID_CHARS = 128;
const READ_SCOPES: XScope[] = ["tweet.read", "users.read"];

type MissionLedger = {
  id: string;
  familiarId: string;
  sources: Array<{ id: string; url?: string }>;
};

type SourcesDependencies = {
  rejectNonLocalRequest(req: Request): Response | null;
  readJsonBody(req: Request, maxBytes: number): Promise<JsonBodyResult<unknown>>;
  sweepExpiredCache(): Promise<number>;
  requireResearch(familiarId: string): Promise<void>;
  listSources(familiarId: string): Promise<SavedXSource[]>;
  getCachedPost(postId: string): Promise<NormalizedXPost | null>;
  saveCachedSource(
    input: SaveCachedXPostAsSourceInput,
  ): Promise<{ source: SavedXSource; created: boolean }>;
  refreshSource(
    familiarId: string,
    sourceId: string,
    post: NormalizedXPost,
  ): Promise<{ source: SavedXSource; created: false }>;
  removeSource(familiarId: string, sourceId: string): Promise<boolean>;
  markAvailability(postId: string, availability: "deleted"): Promise<void>;
  reconcileAttachments(
    familiarId: string,
    attachments: ReadonlyMap<string, readonly string[]>,
  ): Promise<SavedXSource[]>;
  listMissions(): Promise<MissionLedger[]>;
  loadMission(id: string): Promise<MissionLedger | null>;
  makeRunner(): {
    act(id: string, input: unknown): Promise<unknown>;
  };
  withLifecycleLock<T>(
    familiarId: string,
    operation: () => Promise<T>,
  ): Promise<T>;
  setMissionAttached(familiarId: string, sourceId: string, missionId: string): Promise<void>;
  withAuthenticatedRead(
    familiarId: string,
    scopes: XScope[],
    operation: (accessToken: string) => Promise<NormalizedXPost>,
  ): Promise<NormalizedXPost>;
  lookupPost(accessToken: string, postId: string): Promise<NormalizedXPost>;
  errorResponse(error: unknown): Response;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}

function invalidRequest(message = "Saved X source request is invalid"): never {
  throw new XApiError("invalid-request", message);
}

function familiarId(value: unknown): string {
  if (typeof value !== "string" || !isValidFamiliarId(value)) {
    return invalidRequest("Familiar id is invalid");
  }
  return value;
}

function sourceId(value: unknown): string {
  if (typeof value !== "string"
    || value.length === 0
    || Array.from(value).length > MAX_SOURCE_ID_CHARS
    || !/^[A-Za-z0-9_-]+$/.test(value)) {
    return invalidRequest("Saved X source id is invalid");
  }
  return value;
}

function postId(value: unknown): string {
  if (typeof value !== "string" || !/^\d{1,32}$/.test(value)) {
    return invalidRequest("X post id is invalid");
  }
  return value;
}

function originalUrl(value: unknown, expectedPostId: string): string {
  if (typeof value !== "string"
    || value.length === 0
    || Array.from(value).length > MAX_URL_CHARS) {
    return invalidRequest("X post URL is invalid");
  }
  const parsed = parseXPostUrl(value);
  if (parsed.postId !== expectedPostId) return invalidRequest("X post URL is invalid");
  return value;
}

function note(value: unknown): string {
  if (typeof value !== "string" || Array.from(value).length > MAX_NOTE_CHARS) {
    return invalidRequest();
  }
  return value;
}

function tags(value: unknown): string[] {
  if (!Array.isArray(value)
    || value.length > MAX_TAGS
    || value.some((tag) => typeof tag !== "string"
      || Array.from(tag).length > MAX_TAG_CHARS)) {
    return invalidRequest();
  }
  return value as string[];
}

function missionId(value: unknown): string {
  if (!isValidResearchMissionId(value)) {
    return invalidRequest("Research mission id is invalid");
  }
  return value;
}

function savedSource(sources: SavedXSource[], id: string): SavedXSource {
  const source = sources.find((candidate) => candidate.id === id);
  if (!source) throw new XApiError("not-found", "Saved X source was not found");
  return source;
}

async function markDeletedOnNotFound(
  error: unknown,
  post: string,
  dependencies: SourcesDependencies,
): Promise<never> {
  if (error instanceof XApiError && error.code === "not-found") {
    await dependencies.markAvailability(post, "deleted");
  }
  throw error;
}

export function createXSourcesHandlers(dependencies: SourcesDependencies) {
  async function enter(req: Request): Promise<Response | null> {
    const forbidden = dependencies.rejectNonLocalRequest(req);
    if (forbidden) return forbidden;
    await dependencies.sweepExpiredCache();
    return null;
  }

  async function GET(req: Request): Promise<Response> {
    try {
      const blocked = await enter(req);
      if (blocked) return blocked;
      const url = new URL(req.url);
      const familiarValues = url.searchParams.getAll("familiarId");
      if (familiarValues.length !== 1) invalidRequest("Familiar id is invalid");
      const scopedFamiliarId = familiarId(familiarValues[0]);
      await dependencies.requireResearch(scopedFamiliarId);
      const sources = await dependencies.withLifecycleLock(
        scopedFamiliarId,
        async () => {
          const savedSources = await dependencies.listSources(scopedFamiliarId);
          const savedIds = new Set(savedSources.map((source) => source.id));
          const savedIdsByPostId = new Map<string, string | null>();
          for (const source of savedSources) {
            savedIdsByPostId.set(
              source.postId,
              savedIdsByPostId.has(source.postId) ? null : source.id,
            );
          }
          const missions = (await dependencies.listMissions()).filter(
            (mission) => mission.familiarId === scopedFamiliarId,
          );
          const attachments = new Map<string, string[]>();
          for (const mission of missions) {
            for (const source of mission.sources) {
              let matchedSourceId: string | null | undefined = savedIds.has(source.id)
                ? source.id
                : undefined;
              if (!matchedSourceId && typeof source.url === "string") {
                try {
                  matchedSourceId = savedIdsByPostId.get(
                    parseXPostUrl(source.url).postId,
                  );
                } catch {
                  matchedSourceId = undefined;
                }
              }
              if (!matchedSourceId) continue;
              const missionIds = attachments.get(matchedSourceId) ?? [];
              if (!missionIds.includes(mission.id)) missionIds.push(mission.id);
              attachments.set(matchedSourceId, missionIds);
            }
          }
          return dependencies.reconcileAttachments(scopedFamiliarId, attachments);
        },
      );
      const withPreviews = await Promise.all(sources.map(async (source) => {
        const preview = await dependencies.getCachedPost(source.postId);
        return preview ? { ...source, preview } : source;
      }));
      return NextResponse.json({ ok: true, sources: withPreviews });
    } catch (error) {
      return dependencies.errorResponse(error);
    }
  }

  async function POST(req: Request): Promise<Response> {
    try {
      const blocked = await enter(req);
      if (blocked) return blocked;
      const parsed = await dependencies.readJsonBody(req, MAX_BODY_BYTES);
      if (!parsed.ok) return parsed.response;
      if (!isRecord(parsed.body) || typeof parsed.body.action !== "string") invalidRequest();

      if (parsed.body.action === "save") {
        if (!exactKeys(parsed.body, ["action", "familiarId", "postId", "originalUrl", "note", "tags"])) {
          invalidRequest();
        }
        const scopedFamiliarId = familiarId(parsed.body.familiarId);
        const scopedPostId = postId(parsed.body.postId);
        const scopedOriginalUrl = originalUrl(parsed.body.originalUrl, scopedPostId);
        const scopedNote = note(parsed.body.note);
        const scopedTags = tags(parsed.body.tags);
        await dependencies.requireResearch(scopedFamiliarId);
        const result = await dependencies.saveCachedSource({
          familiarId: scopedFamiliarId,
          postId: scopedPostId,
          originalUrl: scopedOriginalUrl,
          note: scopedNote,
          tags: scopedTags,
        });
        return NextResponse.json({ ok: true, ...result });
      }

      if (parsed.body.action === "attach") {
        if (!exactKeys(parsed.body, ["action", "familiarId", "sourceId", "missionId"])) {
          invalidRequest();
        }
        const scopedFamiliarId = familiarId(parsed.body.familiarId);
        const scopedSourceId = sourceId(parsed.body.sourceId);
        const scopedMissionId = missionId(parsed.body.missionId);
        await dependencies.requireResearch(scopedFamiliarId);
        const attachedMission = await dependencies.withLifecycleLock(
          scopedFamiliarId,
          async () => {
            const source = savedSource(
              await dependencies.listSources(scopedFamiliarId),
              scopedSourceId,
            );
            const mission = await dependencies.loadMission(scopedMissionId);
            if (!mission || mission.familiarId !== scopedFamiliarId) {
              throw new XApiError("not-found", "Research mission was not found");
            }
            const result = await dependencies.makeRunner().act(scopedMissionId, {
              action: "attach-source",
              source: {
                id: source.id,
                title: source.canonicalUrl,
                url: source.canonicalUrl,
                sourceType: "x-post",
                provider: "x",
                externalId: source.postId,
                availability: source.availability,
                note: source.note,
                status: "candidate",
              },
            });
            await dependencies.setMissionAttached(
              scopedFamiliarId,
              scopedSourceId,
              scopedMissionId,
            );
            return result;
          },
        );
        return NextResponse.json({ ok: true, mission: attachedMission });
      }

      if (parsed.body.action === "refresh") {
        if (!exactKeys(parsed.body, ["action", "familiarId", "sourceId"])) invalidRequest();
        const scopedFamiliarId = familiarId(parsed.body.familiarId);
        const scopedSourceId = sourceId(parsed.body.sourceId);
        await dependencies.requireResearch(scopedFamiliarId);
        const source = savedSource(
          await dependencies.listSources(scopedFamiliarId),
          scopedSourceId,
        );
        const refreshed = await dependencies.withAuthenticatedRead(
          scopedFamiliarId,
          READ_SCOPES,
          (accessToken) => dependencies.lookupPost(accessToken, source.postId),
        ).catch((error: unknown) => (
          markDeletedOnNotFound(error, source.postId, dependencies)
        ));
        const result = await dependencies.refreshSource(
          scopedFamiliarId,
          scopedSourceId,
          refreshed,
        );
        return NextResponse.json({ ok: true, source: result.source, post: refreshed });
      }

      return invalidRequest();
    } catch (error) {
      return dependencies.errorResponse(error);
    }
  }

  async function DELETE(req: Request): Promise<Response> {
    try {
      const blocked = await enter(req);
      if (blocked) return blocked;
      const parsed = await dependencies.readJsonBody(req, MAX_BODY_BYTES);
      if (!parsed.ok) return parsed.response;
      if (!isRecord(parsed.body)
        || !exactKeys(parsed.body, ["familiarId", "sourceId"])) {
        invalidRequest();
      }
      const scopedFamiliarId = familiarId(parsed.body.familiarId);
      const scopedSourceId = sourceId(parsed.body.sourceId);
      await dependencies.requireResearch(scopedFamiliarId);
      const removed = await dependencies.withLifecycleLock(
        scopedFamiliarId,
        () => dependencies.removeSource(scopedFamiliarId, scopedSourceId),
      );
      if (!removed) throw new XApiError("not-found", "Saved X source was not found");
      return NextResponse.json({ ok: true, removed: true });
    } catch (error) {
      return dependencies.errorResponse(error);
    }
  }

  return { GET, POST, DELETE };
}

const handlers = createXSourcesHandlers({
  rejectNonLocalRequest,
  readJsonBody: (req, maxBytes) => readJsonBody<unknown>(req, maxBytes),
  sweepExpiredCache: () => sweepExpiredXCache(),
  requireResearch: (familiarId) => requireXCapability(familiarId, "research"),
  listSources: listSavedXSources,
  getCachedPost: getCachedXPost,
  saveCachedSource: saveCachedXPostAsSource,
  refreshSource: refreshSavedXSourceFromPost,
  removeSource: removeSavedXSource,
  markAvailability: (postId, availability) => markXPostAvailability(postId, availability),
  reconcileAttachments: reconcileXSourceMissionAttachments,
  listMissions: listResearchMissions,
  loadMission: loadResearchMission,
  makeRunner: () => {
    const runner = makeProductionResearchMissionRunner();
    return {
      act: (id, input) => runner.act(id, input as ResearchMissionActionInput),
    };
  },
  withLifecycleLock: withXSourceLifecycleLock,
  setMissionAttached: setXSourceMissionAttached,
  withAuthenticatedRead: (familiarId, scopes, operation) => (
    withXAuthenticatedRead(familiarId, scopes, operation)
  ),
  lookupPost: lookupXPost,
  errorResponse: toXErrorResponse,
});

export async function GET(req: Request) {
  return handlers.GET(req);
}

export async function POST(req: Request) {
  return handlers.POST(req);
}

export async function DELETE(req: Request) {
  return handlers.DELETE(req);
}
