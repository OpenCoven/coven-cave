import { NextResponse } from "next/server";

import { arxivIdFromUrl } from "@/lib/hf-papers";
import { savedLinkDedupeKey } from "@/lib/link-organizer";
import { readJsonBody, rejectNonLocalRequest } from "@/lib/server/api-security";
import { fetchHfPaperMetadata } from "@/lib/server/hf-paper-metadata";
import {
  getSavedLinkById,
  listSavedLinks,
  listSavedLinkSummaries,
  MAX_LINKS_PER_SAVE,
  removeSavedLink,
  reserveXArticleCandidates,
  saveResearchLinks,
  toSavedLinkSummary,
  type XArticleCandidateReservation,
  type ResearchLinkEnrichment,
} from "@/lib/server/research-links";
import {
  assertXArticleIngestCap,
  XArticleIngestCapError,
  enrichXArticleUrls,
  type XArticleBatchResult,
} from "@/lib/server/x-article-ingest";
import { parseXArticleCandidateUrl } from "@/lib/x-articles";
import { collectIngestUrls } from "./ingest-urls";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 64 * 1024;

export type SaveBody = {
  /** Explicit URL list… */
  urls?: unknown;
  /** …or a raw pasted block; URLs are extracted from it. */
  text?: unknown;
  source?: unknown;
};

export type ResearchLinksRouteDependencies = {
  listSavedLinks?: typeof listSavedLinks;
  listSavedLinkSummaries?: typeof listSavedLinkSummaries;
  getSavedLinkById?: typeof getSavedLinkById;
  fetchHfPaperMetadata?: typeof fetchHfPaperMetadata;
  enrichXArticleUrls?: typeof enrichXArticleUrls;
  reserveXArticleCandidates?: (
    urls: readonly string[],
  ) => Promise<XArticleCandidateReservation>;
  saveResearchLinks?: typeof saveResearchLinks;
  removeSavedLink?: typeof removeSavedLink;
};

export function createResearchLinksRouteHandlers(
  dependencies: ResearchLinksRouteDependencies = {},
) {
  const loadSavedLinkSummaries = dependencies.listSavedLinkSummaries ?? listSavedLinkSummaries;
  const loadSavedLinkById = dependencies.getSavedLinkById ?? getSavedLinkById;
  const fetchPaperMetadata = dependencies.fetchHfPaperMetadata ?? fetchHfPaperMetadata;
  const enrichArticles = dependencies.enrichXArticleUrls ?? enrichXArticleUrls;
  const reserveArticles = dependencies.reserveXArticleCandidates ?? reserveXArticleCandidates;
  const saveLinks = dependencies.saveResearchLinks ?? saveResearchLinks;
  const removeLink = dependencies.removeSavedLink ?? removeSavedLink;

  return {
    async GET(req: Request) {
      const forbidden = rejectNonLocalRequest(req);
      if (forbidden) return forbidden;

      const id = new URL(req.url).searchParams.get("id");
      try {
        if (id !== null) {
          const link = await loadSavedLinkById(id);
          if (!link) {
            return NextResponse.json({ ok: false, error: "link not found" }, { status: 404 });
          }
          return NextResponse.json({ ok: true, link });
        }
        return NextResponse.json({ ok: true, links: await loadSavedLinkSummaries() });
      } catch {
        return NextResponse.json(
          { ok: false, error: "failed to read the saved-links store" },
          { status: 500 },
        );
      }
    },

    async POST(req: Request) {
      const forbidden = rejectNonLocalRequest(req);
      if (forbidden) return forbidden;
      const parsed = await readJsonBody<SaveBody>(req, MAX_BODY_BYTES);
      if (!parsed.ok) return parsed.response;

      const urls = collectIngestUrls(parsed.body);
      if (urls.length === 0) {
        return NextResponse.json(
          { ok: false, error: "no links found — pass urls[] or a text block containing http(s) links" },
          { status: 400 },
        );
      }
      if (urls.length > MAX_LINKS_PER_SAVE) {
        return NextResponse.json(
          { ok: false, error: `too many links in one save (max ${MAX_LINKS_PER_SAVE})` },
          { status: 400 },
        );
      }
      try {
        assertXArticleIngestCap(urls);
      } catch (error) {
        if (error instanceof XArticleIngestCapError) {
          return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
        }
        throw error;
      }

      const source = parsed.body.source === "desk" ? "desk" : "chat";
      const enrichHfPapers = async () => {
        const enrichment = new Map<string, ResearchLinkEnrichment>();
        await Promise.all(
          urls.map(async (url) => {
            // Classify the URL, never scan it: a wrapper that merely embeds a paper
            // URL is a different page, and enriching it would title it after the
            // paper it quotes.
            const arxivId = arxivIdFromUrl(url);
            if (!arxivId) return;
            const paper = await fetchPaperMetadata(arxivId);
            if (paper) enrichment.set(url, { paper });
          }),
        );
        return enrichment;
      };
      const saveAndRespond = async (
        urlsToSave: string[],
        enrichment: Map<string, ResearchLinkEnrichment>,
        duplicates: string[] = [],
        failed: XArticleBatchResult["failures"] = [],
      ) => {
        let result;
        try {
          result = await saveLinks(urlsToSave, source, enrichment);
        } catch {
          return NextResponse.json(
            { ok: false, error: "failed to write the saved-links store" },
            { status: 500 },
          );
        }
        return NextResponse.json({
          ok: true,
          added: result.added.map(toSavedLinkSummary),
          duplicates: [...result.duplicates, ...duplicates],
          invalid: result.invalid,
          failed,
        });
      };
      const xCandidateUrls = urls.filter((url) => parseXArticleCandidateUrl(url) !== null);
      if (xCandidateUrls.length === 0) {
        return saveAndRespond(urls, await enrichHfPapers());
      }

      let reservation: XArticleCandidateReservation;
      try {
        reservation = await reserveArticles(urls);
      } catch {
        return NextResponse.json(
          { ok: false, error: "failed to read the saved-links store" },
          { status: 500 },
        );
      }

      try {
        const enrichment = await enrichHfPapers();

        let xResult: XArticleBatchResult;
        try {
          xResult = await enrichArticles(reservation.reservedUrls, new Set());
        } catch (error) {
          if (error instanceof XArticleIngestCapError) {
            return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
          }
          throw error;
        }
        for (const [url, xEnrichment] of xResult.enrichments) {
          enrichment.set(url, { ...enrichment.get(url), ...xEnrichment });
        }

        const failedIdentities = new Set(
          xResult.failures.map((failure) => savedLinkDedupeKey(failure.url)),
        );
        const enrichedIdentities = new Set(
          [...xResult.enrichments.keys()].map((url) => savedLinkDedupeKey(url)),
        );
        const skippedIdentities = new Set([
          ...reservation.existingIdentities,
          ...reservation.contendedIdentities,
        ]);
        const skippedDuplicates: string[] = [];
        const urlsToSave = urls.filter((url) => {
          if (!parseXArticleCandidateUrl(url)) return true;
          const identity = savedLinkDedupeKey(url);
          if (skippedIdentities.has(identity)) {
            skippedDuplicates.push(url);
            return false;
          }
          if (failedIdentities.has(identity)) return false;
          return enrichedIdentities.has(identity);
        });

        return saveAndRespond(urlsToSave, enrichment, skippedDuplicates, xResult.failures);
      } finally {
        await reservation.release();
      }
    },

    async DELETE(req: Request) {
      const forbidden = rejectNonLocalRequest(req);
      if (forbidden) return forbidden;
      const parsed = await readJsonBody<{ id?: unknown }>(req, MAX_BODY_BYTES);
      if (!parsed.ok) return parsed.response;
      const id = typeof parsed.body.id === "string" ? parsed.body.id.trim() : "";
      if (!id) {
        return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
      }
      let removed: boolean;
      try {
        removed = await removeLink(id);
      } catch {
        return NextResponse.json(
          { ok: false, error: "failed to write the saved-links store" },
          { status: 500 },
        );
      }
      if (!removed) {
        return NextResponse.json({ ok: false, error: "link not found" }, { status: 404 });
      }
      return NextResponse.json({ ok: true });
    },
  };
}

const handlers = createResearchLinksRouteHandlers();
export const GET = handlers.GET;
export const POST = handlers.POST;
export const DELETE = handlers.DELETE;
