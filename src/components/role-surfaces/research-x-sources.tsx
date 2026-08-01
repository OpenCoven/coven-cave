"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { useAnnouncer } from "@/components/ui/live-region";
import { RelativeTime } from "@/components/ui/relative-time";
import { SearchInput } from "@/components/ui/search-input";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { openFamiliarStudioSettingsTab } from "@/lib/familiar-studio-context";
import type { Familiar } from "@/lib/types";
import {
  parseXPostUrl,
  type NormalizedXPost,
  type XErrorCode,
} from "@/lib/x-api";
import {
  parseResearchMission,
  type ResearchMission,
} from "@/lib/research-missions";
import "@/styles/globals/surface-research-resources.css";

type XConnection = {
  configured: boolean;
  connected: boolean;
  activeFlow: boolean;
};

type XSourceAvailability = "available" | "unavailable" | "deleted";

type SavedXSourceView = {
  id: string;
  familiarId: string;
  postId: string;
  canonicalUrl: string;
  originalUrl: string;
  note: string;
  tags: string[];
  addedAt: string;
  updatedAt: string;
  attachedMissionIds: string[];
  availability: XSourceAvailability;
  preview?: NormalizedXPost;
};

type XFailure = {
  code: XErrorCode | "internal";
  retryAt?: string;
};

type XRequestResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: XFailure }
  | { ok: false; cancelled: true };

type ResearchXSourcesProps = {
  familiar: Pick<Familiar, "id" | "display_name" | "xResearchEnabled">;
  selectedMissionId: string | null;
  onMissionAttached?: (mission: ResearchMission) => void;
};

const MAX_PREVIEWS = 10;
const URL_ERROR_ID = "research-x-url-error";
const SEARCH_ERROR_ID = "research-x-search-error";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isXErrorCode(value: unknown): value is XErrorCode {
  return typeof value === "string" && [
    "not-configured",
    "not-connected",
    "capability-disabled",
    "missing-scope",
    "unauthorized",
    "billing-unavailable",
    "rate-limited",
    "not-found",
    "invalid-request",
    "upstream-unavailable",
    "ambiguous-write",
    "invalid-response",
    "oauth-in-progress",
    "oauth-port-in-use",
    "oauth-expired",
  ].includes(value);
}

function parseFailure(value: unknown): XFailure {
  if (!isRecord(value)) return { code: "internal" };
  const code = isXErrorCode(value.code) ? value.code : "internal";
  return {
    code,
    ...(typeof value.retryAt === "string" ? { retryAt: value.retryAt } : {}),
  };
}

function parsePost(value: unknown): NormalizedXPost | null {
  if (!isRecord(value)
    || typeof value.id !== "string"
    || !/^\d{1,32}$/.test(value.id)
    || typeof value.canonicalUrl !== "string"
    || typeof value.text !== "string"
    || typeof value.createdAt !== "string"
    || !Number.isFinite(Date.parse(value.createdAt))
    || !isRecord(value.author)
    || typeof value.author.id !== "string"
    || typeof value.author.username !== "string"
    || !/^[A-Za-z0-9_]{1,15}$/.test(value.author.username)
    || (value.author.name !== undefined && typeof value.author.name !== "string")) {
    return null;
  }
  try {
    const parsed = parseXPostUrl(value.canonicalUrl);
    if (parsed.postId !== value.id || parsed.canonicalUrl !== value.canonicalUrl) return null;
  } catch {
    return null;
  }
  return {
    id: value.id,
    canonicalUrl: value.canonicalUrl,
    text: value.text,
    author: {
      id: value.author.id,
      username: value.author.username,
      ...(typeof value.author.name === "string" ? { name: value.author.name } : {}),
    },
    createdAt: value.createdAt,
  };
}

function parseSource(value: unknown): SavedXSourceView | null {
  if (!isRecord(value)
    || typeof value.id !== "string"
    || typeof value.familiarId !== "string"
    || typeof value.postId !== "string"
    || !/^\d{1,32}$/.test(value.postId)
    || typeof value.canonicalUrl !== "string"
    || typeof value.originalUrl !== "string"
    || typeof value.note !== "string"
    || !Array.isArray(value.tags)
    || value.tags.some((tag) => typeof tag !== "string")
    || typeof value.addedAt !== "string"
    || typeof value.updatedAt !== "string"
    || !Array.isArray(value.attachedMissionIds)
    || value.attachedMissionIds.some((id) => typeof id !== "string")
    || !["available", "unavailable", "deleted"].includes(String(value.availability))) {
    return null;
  }
  try {
    const parsed = parseXPostUrl(value.canonicalUrl);
    if (parsed.postId !== value.postId || parsed.canonicalUrl !== value.canonicalUrl) return null;
  } catch {
    return null;
  }
  const preview = value.preview === undefined ? undefined : parsePost(value.preview);
  if (value.preview !== undefined && !preview) return null;
  return {
    id: value.id,
    familiarId: value.familiarId,
    postId: value.postId,
    canonicalUrl: value.canonicalUrl,
    originalUrl: value.originalUrl,
    note: value.note,
    tags: value.tags as string[],
    addedAt: value.addedAt,
    updatedAt: value.updatedAt,
    attachedMissionIds: value.attachedMissionIds as string[],
    availability: value.availability as XSourceAvailability,
    ...(preview ? { preview } : {}),
  };
}

function errorCopy(error: XFailure): { headline: string; subtitle?: ReactNode } {
  switch (error.code) {
    case "not-configured":
    case "not-connected":
      return { headline: "Connect X in Brain settings." };
    case "capability-disabled":
      return { headline: "Allow X research for this familiar in Brain settings." };
    case "missing-scope":
    case "unauthorized":
      return { headline: "Reconnect X in Brain settings to grant research access." };
    case "billing-unavailable":
      return { headline: "X API access or credits are unavailable." };
    case "rate-limited":
      return {
        headline: "X rate limit reached.",
        subtitle: error.retryAt ? (
          <>Try again <RelativeTime iso={error.retryAt} fallback="later" />.</>
        ) : "Try again later.",
      };
    case "not-found":
      return { headline: "That X post was deleted or is no longer available." };
    case "invalid-request":
      return { headline: "Check the X post URL or search and try again." };
    case "upstream-unavailable":
      return { headline: "X is unavailable right now. Try again when you’re ready." };
    case "invalid-response":
      return { headline: "X returned an unexpected response. Try again when you’re ready." };
    default:
      return { headline: "Couldn’t complete the X request. Try again when you’re ready." };
  }
}

function mergeSource(
  sources: SavedXSourceView[],
  source: SavedXSourceView,
): SavedXSourceView[] {
  const index = sources.findIndex((candidate) => candidate.id === source.id);
  if (index === -1) return [source, ...sources];
  return sources.map((candidate, candidateIndex) => (
    candidateIndex === index ? source : candidate
  ));
}

function mergeSourceRead(
  current: SavedXSourceView[],
  loaded: SavedXSourceView[],
): SavedXSourceView[] {
  const currentIds = new Set(current.map((source) => source.id));
  return [...current, ...loaded.filter((source) => !currentIds.has(source.id))];
}

function XPostPreview({
  post,
  selected,
  onSelect,
  action,
}: {
  post: NormalizedXPost;
  selected?: boolean;
  onSelect?: () => void;
  action?: ReactNode;
}) {
  const body = (
    <>
      <span className="research-x-post__meta">
        <strong>@{post.author.username}</strong>
        <RelativeTime iso={post.createdAt} fallback="recently" />
      </span>
      <span className="research-x-post__text">{post.text}</span>
    </>
  );
  return (
    <article className="research-x-post" data-x-preview data-selected={selected || undefined}>
      {onSelect ? (
        <button
          type="button"
          className="research-x-post__select focus-ring"
          aria-pressed={selected}
          onClick={onSelect}
        >
          {body}
        </button>
      ) : (
        <div className="research-x-post__content">{body}</div>
      )}
      <footer className="research-x-post__footer">
        <a
          className="research-x-post__link focus-ring"
          href={post.canonicalUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Open X post by @${post.author.username}`}
        >
          {post.canonicalUrl}
        </a>
        {action}
      </footer>
    </article>
  );
}

export function ResearchXSources(props: ResearchXSourcesProps) {
  const scopeKey = `${props.familiar.id}:${
    props.familiar.xResearchEnabled === true ? "enabled" : "disabled"
  }`;
  return <ResearchXSourcesScope key={scopeKey} {...props} />;
}

function ResearchXSourcesScope({
  familiar,
  selectedMissionId,
  onMissionAttached,
}: ResearchXSourcesProps) {
  const { announce } = useAnnouncer();
  const scopeKey = `${familiar.id}:${familiar.xResearchEnabled === true ? "enabled" : "disabled"}`;
  const scopeKeyRef = useRef(scopeKey);
  const generationRef = useRef(0);
  const mountedRef = useRef(true);
  const controllersRef = useRef(new Set<AbortController>());
  const previewControllerRef = useRef<AbortController | null>(null);
  const previewRequestRef = useRef(0);
  const sourceCardRefs = useRef(new Map<string, HTMLElement>());
  const sourceMutationEpochRef = useRef(0);

  const [connection, setConnection] = useState<XConnection | null>(null);
  const [connectionError, setConnectionError] = useState<XFailure | null>(null);
  const [connectionLoading, setConnectionLoading] = useState(true);
  const [sources, setSources] = useState<SavedXSourceView[]>([]);
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [sourcesError, setSourcesError] = useState<XFailure | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [urlDraft, setUrlDraft] = useState("");
  const [urlError, setUrlError] = useState<XFailure | null>(null);
  const [lookupBusy, setLookupBusy] = useState(false);
  const [searchDraft, setSearchDraft] = useState("");
  const [searchError, setSearchError] = useState<XFailure | null>(null);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchCompleted, setSearchCompleted] = useState(false);
  const [previews, setPreviews] = useState<NormalizedXPost[]>([]);
  const [selectedPreviewId, setSelectedPreviewId] = useState<string | null>(null);
  const [previewMutationError, setPreviewMutationError] = useState<XFailure | null>(null);
  const [sourceBusy, setSourceBusy] = useState<string | null>(null);
  const [sourceErrors, setSourceErrors] = useState<Record<string, XFailure>>({});

  const isCurrent = useCallback((key: string, generation: number) => (
    mountedRef.current
    && scopeKeyRef.current === key
    && generationRef.current === generation
  ), []);

  const controller = useCallback(() => {
    const next = new AbortController();
    controllersRef.current.add(next);
    return next;
  }, []);

  const releaseController = useCallback((value: AbortController) => {
    controllersRef.current.delete(value);
  }, []);

  const request = useCallback(async <T,>(
    url: string,
    init: RequestInit,
    parseSuccess: (value: unknown) => T | null,
    requestController: AbortController,
  ): Promise<XRequestResult<T>> => {
    try {
      const response = await fetch(url, { ...init, signal: requestController.signal });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok || !isRecord(body) || body.ok === false) {
        return { ok: false, error: parseFailure(body) };
      }
      const value = parseSuccess(body);
      return value === null
        ? { ok: false, error: { code: "invalid-response" } }
        : { ok: true, value };
    } catch (error) {
      if (requestController.signal.aborted) {
        return { ok: false, cancelled: true };
      }
      return { ok: false, error: { code: "upstream-unavailable" } };
    } finally {
      releaseController(requestController);
    }
  }, [releaseController]);

  useEffect(() => {
    mountedRef.current = true;
    const key = scopeKey;
    const generation = ++generationRef.current;
    const connectionController = controller();

    for (const active of controllersRef.current) {
      if (active !== connectionController) active.abort();
    }
    previewControllerRef.current = null;
    previewRequestRef.current += 1;
    setConnection(null);
    setConnectionError(null);
    setConnectionLoading(true);
    setSources([]);
    setSourcesError(null);
    setSourcesLoading(false);
    setUrlDraft("");
    setUrlError(null);
    setLookupBusy(false);
    setSearchDraft("");
    setSearchError(null);
    setSearchBusy(false);
    setSearchCompleted(false);
    setPreviews([]);
    setSelectedPreviewId(null);
    setPreviewMutationError(null);
    setSourceBusy(null);
    setSourceErrors({});

    void (async () => {
      try {
        const response = await fetch("/api/x/connection", {
          cache: "no-store",
          signal: connectionController.signal,
        });
        const body: unknown = await response.json().catch(() => null);
        if (!isCurrent(key, generation)) return;
        if (!response.ok
          || !isRecord(body)
          || typeof body.configured !== "boolean"
          || typeof body.connected !== "boolean"
          || typeof body.activeFlow !== "boolean") {
          setConnectionError(parseFailure(body));
          return;
        }
        const nextConnection: XConnection = {
          configured: body.configured,
          connected: body.connected,
          activeFlow: body.activeFlow,
        };
        setConnection(nextConnection);
        setConnectionLoading(false);
        if (!nextConnection.connected || familiar.xResearchEnabled !== true) return;

        setSourcesLoading(true);
        const sourceReadEpoch = sourceMutationEpochRef.current;
        const sourcesController = controller();
        try {
          const sourcesResponse = await fetch(
            `/api/x/sources?familiarId=${encodeURIComponent(familiar.id)}`,
            { cache: "no-store", signal: sourcesController.signal },
          );
          const sourcesBody: unknown = await sourcesResponse.json().catch(() => null);
          if (!isCurrent(key, generation)) return;
          if (!sourcesResponse.ok
            || !isRecord(sourcesBody)
            || sourcesBody.ok !== true
            || !Array.isArray(sourcesBody.sources)) {
            setSourcesError(parseFailure(sourcesBody));
            return;
          }
          const parsed = sourcesBody.sources.map(parseSource);
          if (parsed.some((candidate) => candidate === null)) {
            setSourcesError({ code: "invalid-response" });
            return;
          }
          setSources((current) => (
            sourceReadEpoch === sourceMutationEpochRef.current
              ? parsed as SavedXSourceView[]
              : mergeSourceRead(current, parsed as SavedXSourceView[])
          ));
        } catch {
          if (!sourcesController.signal.aborted && isCurrent(key, generation)) {
            setSourcesError({ code: "upstream-unavailable" });
          }
        } finally {
          releaseController(sourcesController);
          if (isCurrent(key, generation)) setSourcesLoading(false);
        }
      } catch {
        if (connectionController.signal.aborted || !isCurrent(key, generation)) return;
        setConnectionError({ code: "upstream-unavailable" });
      } finally {
        releaseController(connectionController);
        if (isCurrent(key, generation)) {
          setConnectionLoading(false);
          setSourcesLoading(false);
        }
      }
    })();

    return () => {
      for (const active of controllersRef.current) active.abort();
    };
  }, [
    controller,
    familiar.id,
    familiar.xResearchEnabled,
    isCurrent,
    releaseController,
    reloadNonce,
    scopeKey,
  ]);

  useEffect(() => () => {
    mountedRef.current = false;
    for (const active of controllersRef.current) active.abort();
  }, []);

  const postJson = useCallback(async <T,>(
    url: string,
    body: Record<string, unknown>,
    parseSuccess: (value: unknown) => T | null,
    requestController = controller(),
  ): Promise<XRequestResult<T>> => {
    return request(
      url,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
      parseSuccess,
      requestController,
    );
  }, [controller, request]);

  const beginPreviewRequest = useCallback(() => {
    previewControllerRef.current?.abort();
    const requestController = controller();
    previewControllerRef.current = requestController;
    const requestId = ++previewRequestRef.current;
    return { requestController, requestId };
  }, [controller]);

  const ownsPreviewRequest = useCallback((
    key: string,
    generation: number,
    requestId: number,
    requestController: AbortController,
  ) => (
    isCurrent(key, generation)
    && previewRequestRef.current === requestId
    && previewControllerRef.current === requestController
  ), [isCurrent]);

  const submitLookup = async (event: FormEvent) => {
    event.preventDefault();
    if (lookupBusy) return;
    let parsed: ReturnType<typeof parseXPostUrl>;
    try {
      parsed = parseXPostUrl(urlDraft);
    } catch {
      setUrlError({ code: "invalid-request" });
      return;
    }
    const key = scopeKeyRef.current;
    const generation = generationRef.current;
    const { requestController, requestId } = beginPreviewRequest();
    setLookupBusy(true);
    setSearchBusy(false);
    setUrlError(null);
    setSearchError(null);
    setSearchCompleted(false);
    setPreviews([]);
    setSelectedPreviewId(null);
    setPreviewMutationError(null);
    const result = await postJson(
      "/api/x/posts/lookup",
      { familiarId: familiar.id, url: parsed.canonicalUrl },
      (value) => {
        if (!isRecord(value)) return null;
        return parsePost(value.post);
      },
      requestController,
    );
    if (!ownsPreviewRequest(key, generation, requestId, requestController)) return;
    previewControllerRef.current = null;
    setLookupBusy(false);
    setSearchBusy(false);
    if (!result.ok) {
      if ("cancelled" in result) return;
      setUrlError(result.error);
      return;
    }
    setPreviews([result.value]);
    setSelectedPreviewId(result.value.id);
    announce("Found 1 X post.");
  };

  const submitSearch = async (event: FormEvent) => {
    event.preventDefault();
    if (searchBusy) return;
    const query = searchDraft.trim();
    if (!query) {
      setSearchError({ code: "invalid-request" });
      return;
    }
    const key = scopeKeyRef.current;
    const generation = generationRef.current;
    const { requestController, requestId } = beginPreviewRequest();
    setLookupBusy(false);
    setSearchBusy(true);
    setUrlError(null);
    setSearchError(null);
    setSearchCompleted(false);
    setPreviews([]);
    setSelectedPreviewId(null);
    setPreviewMutationError(null);
    const result = await postJson(
      "/api/x/posts/search",
      { familiarId: familiar.id, query },
      (value) => {
        if (!isRecord(value) || !Array.isArray(value.posts)) return null;
        const posts = value.posts.slice(0, MAX_PREVIEWS).map(parsePost);
        return posts.some((candidate) => candidate === null)
          ? null
          : posts as NormalizedXPost[];
      },
      requestController,
    );
    if (!ownsPreviewRequest(key, generation, requestId, requestController)) return;
    previewControllerRef.current = null;
    setLookupBusy(false);
    setSearchBusy(false);
    if (!result.ok) {
      if ("cancelled" in result) return;
      setSearchCompleted(false);
      setSearchError(result.error);
      return;
    }
    setPreviews(result.value);
    setSelectedPreviewId(result.value[0]?.id ?? null);
    setSearchCompleted(true);
    announce(`Found ${result.value.length} X ${result.value.length === 1 ? "post" : "posts"}.`);
  };

  const savePost = async (post: NormalizedXPost) => {
    if (sourceBusy) return;
    const key = scopeKeyRef.current;
    const generation = generationRef.current;
    setSourceBusy(`save:${post.id}`);
    setPreviewMutationError(null);
    const result = await postJson(
      "/api/x/sources",
      {
        action: "save",
        familiarId: familiar.id,
        postId: post.id,
        originalUrl: post.canonicalUrl,
        note: "",
        tags: [],
      },
      (value) => {
        if (!isRecord(value) || typeof value.created !== "boolean") return null;
        const parsed = parseSource(value.source);
        return parsed ? { source: parsed, created: value.created } : null;
      },
    );
    if (!isCurrent(key, generation)) return;
    setSourceBusy(null);
    if (!result.ok) {
      if ("cancelled" in result) return;
      const message = errorCopy(result.error).headline;
      setPreviewMutationError(result.error);
      announce(message, "assertive");
      return;
    }
    sourceMutationEpochRef.current += 1;
    setSources((current) => mergeSource(current, {
      ...result.value.source,
      preview: result.value.source.preview ?? post,
    }));
    announce(result.value.created ? "X source saved." : "X source was already saved.");
  };

  const attachSource = async (source: SavedXSourceView) => {
    if (!selectedMissionId || sourceBusy) return;
    const requestedMissionId = selectedMissionId;
    const key = scopeKeyRef.current;
    const generation = generationRef.current;
    setSourceBusy(`attach:${source.id}`);
    setSourceErrors((current) => {
      const next = { ...current };
      delete next[source.id];
      return next;
    });
    const result = await postJson(
      "/api/x/sources",
      {
        action: "attach",
        familiarId: familiar.id,
        sourceId: source.id,
        missionId: requestedMissionId,
      },
      (value) => {
        if (!isRecord(value)) return null;
        const mission = parseResearchMission(value.mission);
        return mission
          && mission.id === requestedMissionId
          && mission.familiarId === familiar.id
          ? mission
          : null;
      },
    );
    if (!isCurrent(key, generation)) return;
    setSourceBusy(null);
    if (!result.ok) {
      if ("cancelled" in result) return;
      const message = errorCopy(result.error).headline;
      setSourceErrors((current) => ({ ...current, [source.id]: result.error }));
      announce(message, "assertive");
      return;
    }
    setSourceErrors((current) => {
      const next = { ...current };
      delete next[source.id];
      return next;
    });
    onMissionAttached?.(result.value);
    sourceMutationEpochRef.current += 1;
    setSources((current) => current.map((candidate) => (
      candidate.id === source.id && !candidate.attachedMissionIds.includes(requestedMissionId)
        ? {
            ...candidate,
            attachedMissionIds: [...candidate.attachedMissionIds, requestedMissionId],
          }
        : candidate
    )));
    announce("X source attached to the mission.");
  };

  const refreshSource = async (source: SavedXSourceView) => {
    if (sourceBusy) return;
    const key = scopeKeyRef.current;
    const generation = generationRef.current;
    setSourceBusy(`refresh:${source.id}`);
    setSourceErrors((current) => {
      const next = { ...current };
      delete next[source.id];
      return next;
    });
    const result = await postJson(
      "/api/x/sources",
      {
        action: "refresh",
        familiarId: familiar.id,
        sourceId: source.id,
      },
      (value) => {
        if (!isRecord(value)) return null;
        const refreshedSource = parseSource(value.source);
        const refreshedPost = parsePost(value.post);
        return refreshedSource && refreshedPost
          ? { source: refreshedSource, post: refreshedPost }
          : null;
      },
    );
    if (!isCurrent(key, generation)) return;
    setSourceBusy(null);
    if (!result.ok) {
      if ("cancelled" in result) return;
      const message = errorCopy(result.error).headline;
      setSourceErrors((current) => ({ ...current, [source.id]: result.error }));
      if (result.error.code === "not-found") {
        sourceCardRefs.current.get(source.id)?.focus();
        sourceMutationEpochRef.current += 1;
        setSources((current) => current.map((candidate) => (
          candidate.id === source.id
            ? { ...candidate, availability: "deleted", preview: undefined }
            : candidate
        )));
      }
      announce(message, "assertive");
      return;
    }
    sourceCardRefs.current.get(source.id)?.focus();
    sourceMutationEpochRef.current += 1;
    setSources((current) => mergeSource(current, {
      ...result.value.source,
      preview: result.value.post,
    }));
    announce("X post refreshed.");
  };

  const brainAction = (
    <Button
      size="sm"
      variant="secondary"
      onClick={() => openFamiliarStudioSettingsTab("brain", familiar.id)}
    >
      Open Brain settings
    </Button>
  );

  if (connectionLoading) {
    return (
      <section className="research-x" aria-label="Grab from X" aria-busy="true">
        <SkeletonGroup className="research-x__skeleton">
          <Skeleton variant="text" width="30%" />
          <Skeleton variant="row" />
          <Skeleton variant="row" />
        </SkeletonGroup>
      </section>
    );
  }

  if (connectionError) {
    const copy = errorCopy(connectionError);
    return (
      <section className="research-x" aria-label="Grab from X">
        <ErrorState
          compact
          headline="Couldn’t load X"
          subtitle={copy.headline}
          actions={
            <Button size="sm" variant="secondary" onClick={() => setReloadNonce((value) => value + 1)}>
              Retry
            </Button>
          }
        />
      </section>
    );
  }

  if (!connection?.connected) {
    return (
      <section className="research-x" aria-label="Grab from X">
        <EmptyState
          compact
          headline="Connect X"
          subtitle="Connect X before grabbing posts for research."
          actions={brainAction}
        />
      </section>
    );
  }

  if (familiar.xResearchEnabled !== true) {
    return (
      <section className="research-x" aria-label="Grab from X">
        <EmptyState
          compact
          headline="Allow X research"
          subtitle={`Give ${familiar.display_name} access before grabbing X sources.`}
          actions={brainAction}
        />
      </section>
    );
  }

  const selectedPreview = previews.find((candidate) => candidate.id === selectedPreviewId) ?? null;

  return (
    <section className="research-x" aria-labelledby="research-x-title">
      <header className="research-x__heading">
        <div>
          <h3 id="research-x-title">Grab from X</h3>
          <p>Look up one post or search the previous seven days. Nothing saves automatically.</p>
        </div>
      </header>

      <div className="research-x__forms">
        <form className="research-x__form" aria-label="Grab X post" onSubmit={submitLookup}>
          <label htmlFor="research-x-url">X post URL</label>
          <div className="research-x__field-row">
            <input
              id="research-x-url"
              className="research-x__url focus-ring"
              type="url"
              value={urlDraft}
              onChange={(event) => {
                setUrlDraft(event.target.value);
                setUrlError(null);
              }}
              placeholder="https://x.com/handle/status/…"
              aria-label="X post URL"
              aria-invalid={urlError ? true : undefined}
              aria-describedby={urlError ? URL_ERROR_ID : undefined}
            />
            <Button
              type="submit"
              size="sm"
              variant="secondary"
              loading={lookupBusy}
              disabled={lookupBusy || !urlDraft.trim()}
            >
              Grab post
            </Button>
          </div>
          {urlError ? (
            <div id={URL_ERROR_ID}>
              <ErrorState
                compact
                headline={errorCopy(urlError).headline}
                subtitle={errorCopy(urlError).subtitle}
              />
            </div>
          ) : null}
        </form>

        <form className="research-x__form" aria-label="Search X posts" onSubmit={submitSearch}>
          <label htmlFor="research-x-search">Search X posts</label>
          <div className="research-x__field-row">
            <SearchInput
              id="research-x-search"
              value={searchDraft}
              onValueChange={(value) => {
                setSearchDraft(value);
                setSearchError(null);
                setSearchCompleted(false);
              }}
              onClear={() => {
                setSearchDraft("");
                setSearchError(null);
                setSearchCompleted(false);
              }}
              placeholder="Search X posts…"
              aria-label="Search X posts"
              aria-invalid={searchError ? true : undefined}
              aria-describedby={searchError ? SEARCH_ERROR_ID : undefined}
              containerClassName="research-x__search"
            />
            <Button
              type="submit"
              size="sm"
              variant="secondary"
              loading={searchBusy}
              disabled={searchBusy || !searchDraft.trim()}
            >
              Search
            </Button>
          </div>
          {searchError ? (
            <div id={SEARCH_ERROR_ID}>
              <ErrorState
                compact
                headline={errorCopy(searchError).headline}
                subtitle={errorCopy(searchError).subtitle}
              />
            </div>
          ) : null}
        </form>
      </div>

      {lookupBusy || searchBusy ? (
        <SkeletonGroup className="research-x__preview-skeleton">
          <Skeleton variant="row" />
          <Skeleton variant="row" />
        </SkeletonGroup>
      ) : previews.length > 0 ? (
        <div className="research-x__previews" aria-label="X post previews">
          {previews.map((candidate) => (
            <XPostPreview
              key={candidate.id}
              post={candidate}
              selected={candidate.id === selectedPreviewId}
              onSelect={() => setSelectedPreviewId(candidate.id)}
              action={candidate.id === selectedPreview?.id ? (
                <Button
                  size="xs"
                  variant="secondary"
                  loading={sourceBusy === `save:${candidate.id}`}
                  disabled={sourceBusy !== null}
                  onClick={() => void savePost(candidate)}
                >
                  Save source
                </Button>
              ) : null}
            />
          ))}
        </div>
      ) : searchCompleted && !searchBusy && !searchError ? (
        <EmptyState
          compact
          live={false}
          headline="No X posts found"
          subtitle="Try a different search when you’re ready."
        />
      ) : null}
      {previewMutationError ? (
        <ErrorState
          compact
          live={false}
          headline={errorCopy(previewMutationError).headline}
          subtitle={errorCopy(previewMutationError).subtitle}
        />
      ) : null}

      <div className="research-x__saved">
        <div className="research-x__saved-heading">
          <h4>Saved X sources</h4>
          <span>{sources.length}</span>
        </div>
        {sourcesLoading ? (
          <SkeletonGroup>
            <Skeleton variant="row" />
            <Skeleton variant="row" />
          </SkeletonGroup>
        ) : sourcesError ? (
          <ErrorState
            compact
            headline="Couldn’t load saved X sources"
            subtitle={errorCopy(sourcesError).headline}
            actions={
              <Button size="xs" variant="secondary" onClick={() => setReloadNonce((value) => value + 1)}>
                Retry
              </Button>
            }
          />
        ) : sources.length === 0 ? (
          <EmptyState
            compact
            headline="No X sources saved"
            subtitle="Grab or search for a post, then save it here."
          />
        ) : (
          <div className="research-x__source-list">
            {sources.map((saved) => {
              const attached = selectedMissionId
                ? saved.attachedMissionIds.includes(selectedMissionId)
                : false;
              const sourceError = sourceErrors[saved.id];
              const attachHelpId = `research-x-attach-help-${saved.id}`;
              return (
                <article
                  className="research-x-source focus-ring"
                  key={saved.id}
                  data-x-source-id={saved.id}
                  tabIndex={-1}
                  ref={(node) => {
                    if (node) sourceCardRefs.current.set(saved.id, node);
                    else sourceCardRefs.current.delete(saved.id);
                  }}
                >
                  {saved.preview ? (
                    <XPostPreview post={saved.preview} />
                  ) : (
                    <div className="research-x-source__identity">
                      <a
                        className="research-x-post__link focus-ring"
                        href={saved.canonicalUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {saved.canonicalUrl}
                      </a>
                      <span>
                        {saved.availability === "deleted"
                          ? "Post deleted"
                          : saved.availability === "unavailable"
                            ? "Post unavailable"
                            : "Preview expired or unavailable."}
                      </span>
                    </div>
                  )}
                  <footer className="research-x-source__actions">
                    <span>
                      saved <RelativeTime iso={saved.addedAt} fallback="recently" />
                    </span>
                    {saved.availability !== "deleted" && !saved.preview ? (
                      <Button
                        size="xs"
                        variant="ghost"
                        loading={sourceBusy === `refresh:${saved.id}`}
                        disabled={sourceBusy !== null}
                        onClick={() => void refreshSource(saved)}
                      >
                        Refresh post
                      </Button>
                    ) : null}
                    {!selectedMissionId ? (
                      <span
                        id={attachHelpId}
                        className="research-x-source__prerequisite"
                      >
                        Select a mission on the Desk first
                      </span>
                    ) : null}
                    <Button
                      size="xs"
                      variant="secondary"
                      disabled={!selectedMissionId || attached || sourceBusy !== null}
                      loading={sourceBusy === `attach:${saved.id}`}
                      aria-describedby={!selectedMissionId ? attachHelpId : undefined}
                      onClick={() => void attachSource(saved)}
                    >
                      {attached ? "Attached" : "Attach to mission"}
                    </Button>
                  </footer>
                  {sourceError ? (
                    <ErrorState
                      compact
                      live={false}
                      headline={errorCopy(sourceError).headline}
                      subtitle={errorCopy(sourceError).subtitle}
                    />
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
