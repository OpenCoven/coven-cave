import { expect, test, type Page } from "@playwright/test";
import { DEFAULT_ELEVENLABS_VOICE_ID } from "../src/lib/voice/elevenlabs-shared";

const FAMILIAR_ID = "rida";
const MISSION_ID = "m-media";
const ELEVENLABS_VOICE_ID = DEFAULT_ELEVENLABS_VOICE_ID;
const now = new Date().toISOString();

const MISSION = {
  version: 1,
  id: MISSION_ID,
  familiarId: FAMILIAR_ID,
  title: "Media pipeline findings",
  intent: "Extract the findings for a media generation.",
  mode: "brief",
  modeSource: "auto",
  deliverable: "brief",
  constraints: [],
  bounds: {
    wallClockMinutes: 60,
    maxIterations: 1,
    sourceTarget: 4,
    checkpointEvery: 1,
    stopWhenCostUnavailable: false,
  },
  status: "completed",
  createdAt: now,
  updatedAt: now,
  startedAt: now,
  finishedAt: now,
  iterations: [
    { number: 1, status: "completed", startedAt: now, finishedAt: now },
  ],
  artifacts: [
    {
      key: "report-1",
      kind: "report",
      title: "Media findings",
      relativePath: "artifacts/report.md",
      state: "published",
      iteration: 1,
      updatedAt: now,
    },
  ],
  sources: [],
};

type MediaKind = "podcast" | "short-video" | "long-video";
type MediaStatus =
  | "draft"
  | "queued"
  | "rendering"
  | "ready"
  | "failed"
  | "cancelled";
type RenderConfig = {
  provider: "local" | "elevenlabs";
  voice: string;
  length: "brief" | "standard" | "extended";
  voices?: { host: string; guest: string };
  style?: "breakdown" | "debate" | "interview" | "recap";
};

function generation(
  kind: MediaKind,
  status: MediaStatus,
  id = `gen-${kind}`,
  renderConfig: RenderConfig = {
    provider: "local",
    voice: "piper-amy",
    length: "standard",
  },
) {
  const script = [
    { id: "segment-1", text: "An extracted finding for the podcast." },
  ];
  const storyboard = [
    {
      id: "scene-1",
      title: "Finding",
      bullets: ["An extracted claim"],
      narration: "An extracted finding for the video.",
    },
  ];
  const content =
    kind === "podcast"
      ? { kind, script }
      : kind === "short-video"
        ? { kind, storyboard }
        : {
            kind,
            chapters: [
              {
                id: "chapter-1",
                title: "Finding",
                scenes: storyboard,
              },
            ],
          };
  const readyContent =
    kind === "podcast"
      ? {
          ...content,
          audio: {
            key: "podcast.wav",
            mimeType: "audio/wav",
            sizeBytes: 128,
            durationMs: 1_000,
            provider: renderConfig.provider,
            voice: renderConfig.voice,
          },
        }
      : {
          ...content,
          video: {
            key:
              kind === "short-video"
                ? "short-video.mp4"
                : "long-video.mp4",
            mimeType: "video/mp4",
            sizeBytes: 128,
            durationMs: 1_000,
            provider: renderConfig.provider,
            voice: renderConfig.voice,
          },
        };
  return {
    version: 2 as const,
    id,
    familiarId: FAMILIAR_ID,
    kind,
    sourceMissionId: MISSION_ID,
    sourceTitle: MISSION.title,
    sourceArtifactKey: "report-1",
    status,
    renderConfig,
    createdAt: now,
    updatedAt: now,
    content: status === "ready" ? readyContent : content,
    ...(status === "rendering"
      ? {
          stage: "synthesizing" as const,
          ...(kind === "long-video"
            ? {
                progress: {
                  unit: "chapter" as const,
                  current: 1,
                  total: 3,
                  label: "Finding",
                },
              }
            : {}),
        }
      : {}),
    ...(status === "failed"
      ? { error: "ffmpeg exited before the render completed" }
      : {}),
  };
}

type MediaGeneration = ReturnType<typeof generation>;
type StoredMediaGeneration = Omit<MediaGeneration, "renderConfig"> & {
  renderConfig: RenderConfig;
};

async function openResearchStudio(page: Page) {
  await page.goto("/");
  await page.getByRole("navigation").first().waitFor({ timeout: 60_000 });
  await expect(async () => {
    await page.evaluate(() =>
      window.dispatchEvent(
        new CustomEvent("cave:navigate-mode", {
          detail: { mode: "surface:researcher-desk" },
        }),
      ),
    );
    await expect(page.locator(".research-desk")).toBeVisible({
      timeout: 3_000,
    });
  }).toPass({ timeout: 90_000 });
  await page.getByRole("tab", { name: /^Studio/ }).click();
}

async function boot(
  page: Page,
  options: {
    ready?: boolean;
    records?: MediaGeneration[];
  } = {},
) {
  let ready = options.ready ?? false;
  let sequence = 0;
  const records = new Map<string, StoredMediaGeneration>(
    (options.records ?? []).map((record) => [
      record.id,
      record as StoredMediaGeneration,
    ]),
  );
  const autoProgress = new Set<string>();
  const pollCounts = new Map<string, number>();
  const createBodies: Array<Record<string, unknown>> = [];

  await page.addInitScript(() => {
    window.localStorage.setItem("cave:onboarding:dismissed", "1");
    window.localStorage.setItem("cave:active-familiar", "rida");
  });
  // #4634 wired onError={reportPlaybackFailure} onto the <audio>/<video>
  // elements, which tears the player AND its Download link out of the DOM the
  // moment the browser cannot decode the source. This harness has always served
  // a 1-byte placeholder for /media — harmless before that change, fatal after —
  // so the media assertions began failing on every PR without the product being
  // broken. This suite has no real codecs and no media fixtures; it fakes the
  // whole backend already, so it fakes decode support too rather than shipping
  // a binary just to satisfy a decoder. React binds media events directly to
  // the element (they do not bubble), so dropping the listener at registration
  // is what actually suppresses it. (cave-4xv9v)
  await page.addInitScript(() => {
    const add = HTMLMediaElement.prototype.addEventListener;
    HTMLMediaElement.prototype.addEventListener = function patched(type, listener, options) {
      if (type === "error") return;
      return add.call(this, type, listener, options);
    } as typeof add;
  });
  await page.route("**/api/familiars**", (route) =>
    route.fulfill({
      json: {
        ok: true,
        familiars: [
          {
            id: FAMILIAR_ID,
            display_name: "Rida",
            role: "Researcher",
            status: "active",
            icon: "ph:sparkle-fill",
          },
        ],
      },
    }),
  );
  await page.route("**/api/sessions/list**", (route) =>
    route.fulfill({ json: { ok: true, sessions: [] } }),
  );
  await page.route(/\/api\/roles(?:\?|$)/, (route) =>
    route.fulfill({ json: { roles: [] } }),
  );
  await page.route(/\/api\/research\/missions\?/, (route) =>
    route.fulfill({ json: { ok: true, missions: [MISSION] } }),
  );
  await page.route("**/api/research/links", (route) =>
    route.fulfill({ json: { ok: true, links: [] } }),
  );
  await page.route(
    /\/api\/research\/generations(?:\/.*)?(?:\?.*)?$/,
    async (route) => {
      const url = new URL(route.request().url());
      const method = route.request().method();
      if (url.pathname.endsWith("/readiness")) {
        await route.fulfill({
          json: {
            ok: true,
            providers: {
              local: {
                ready,
                voices: ready
                  ? [{ id: "piper-amy", name: "Piper Amy", engine: "piper" }]
                  : [],
                hint: ready ? undefined : "Download a local voice.",
              },
              elevenlabs: {
                ready,
                defaultVoiceId: ELEVENLABS_VOICE_ID,
                hint: ready ? undefined : "Configure ElevenLabs in Vault.",
              },
            },
            ffmpeg: {
              ready,
              hint: ready ? undefined : "Install ffmpeg and ffprobe.",
            },
            podcast: {
              ready,
              hint: ready
                ? undefined
                : "Download a local voice or configure ElevenLabs.",
            },
            shortVideo: {
              ready,
              hint: ready
                ? undefined
                : "Install ffmpeg and download a local voice.",
            },
            longVideo: {
              ready,
              hint: ready
                ? undefined
                : "Install ffmpeg and download a local voice.",
            },
          },
        });
        return;
      }
      // #4634 put a ticket hop in front of playback: the client asks for a
      // signed media URL and only renders <audio>/<video> once it resolves, so
      // an unmocked ticket meant no media element at all and the viewer showed
      // "Couldn't load podcast audio." The spec's route regex already matched
      // this path, so the request was intercepted and fell through to the
      // generations LIST response — shaped nothing like a ticket — rather than
      // reaching a real handler. Answer it before /media, whose bytes the
      // resolved URL then requests. (cave-4xv9v)
      if (url.pathname.endsWith("/media-ticket")) {
        const familiarId = url.searchParams.get("familiarId") ?? "";
        const id = url.searchParams.get("id") ?? "";
        await route.fulfill({
          json: {
            ok: true,
            mediaUrl: `/api/research/generations/media?familiarId=${encodeURIComponent(familiarId)}&id=${encodeURIComponent(id)}`,
          },
        });
        return;
      }
      if (url.pathname.endsWith("/media")) {
        const target = records.get(url.searchParams.get("id") ?? "");
        await route.fulfill({
          status: 206,
          headers: {
            "content-type":
              target?.kind === "podcast" ? "audio/wav" : "video/mp4",
            "content-range": "bytes 0-0/1",
            "accept-ranges": "bytes",
          },
          body: "0",
        });
        return;
      }
      if (url.pathname.endsWith("/render") && method === "POST") {
        const body = route.request().postDataJSON() as { id: string };
        const current = records.get(body.id);
        if (!current) {
          await route.fulfill({
            status: 404,
            json: { ok: false, error: "generation not found" },
          });
          return;
        }
        const queued = { ...current, status: "queued" as const };
        records.set(current.id, queued);
        autoProgress.add(current.id);
        pollCounts.set(current.id, 0);
        await route.fulfill({ json: { ok: true, generation: queued } });
        return;
      }
      if (url.pathname.endsWith("/cancel") && method === "POST") {
        const body = route.request().postDataJSON() as { id: string };
        const current = records.get(body.id);
        if (!current) {
          await route.fulfill({
            status: 404,
            json: { ok: false, error: "generation not found" },
          });
          return;
        }
        const cancelled = {
          ...current,
          status: "cancelled" as const,
          stage: undefined,
          progress: undefined,
          error: undefined,
        };
        records.set(current.id, cancelled);
        autoProgress.delete(current.id);
        await route.fulfill({ json: { ok: true, generation: cancelled } });
        return;
      }
      if (method === "DELETE") {
        const body = route.request().postDataJSON() as { id: string };
        records.delete(body.id);
        await route.fulfill({ json: { ok: true } });
        return;
      }
      if (method === "POST") {
        const body = route.request().postDataJSON() as {
          kind: MediaKind;
          renderConfig: RenderConfig;
        };
        createBodies.push(body as unknown as Record<string, unknown>);
        sequence += 1;
        const created = {
          ...generation(body.kind, "draft", `gen-${body.kind}-${sequence}`),
          renderConfig: body.renderConfig,
        };
        records.set(created.id, created);
        await route.fulfill({ json: { ok: true, generation: created } });
        return;
      }

      const listed = [...records.values()].map((record) => {
        if (!autoProgress.has(record.id)) return record;
        const count = (pollCounts.get(record.id) ?? 0) + 1;
        pollCounts.set(record.id, count);
        const next =
          count >= 2
            ? generation(record.kind, "ready", record.id, record.renderConfig)
            : generation(
                record.kind,
                "rendering",
                record.id,
                record.renderConfig,
              );
        records.set(record.id, next);
        if (next.status === "ready") autoProgress.delete(record.id);
        return next;
      });
      await route.fulfill({ json: { ok: true, generations: listed } });
    },
  );

  await openResearchStudio(page);
  return {
    createBodies,
    setReady: () => {
      ready = true;
    },
  };
}

test.describe("Research Studio media honesty and playback", () => {
  test.describe.configure({ timeout: 180_000 });

  test("configures, reviews, renders, plays, and downloads a podcast", async ({
    page,
  }) => {
    const controls = await boot(page);
    const studio = page.locator(".research-studio");
    const podcastCard = studio.locator('button[data-kind="podcast"]');
    await expect(podcastCard).toBeDisabled();
    await expect(podcastCard).toContainText("Download a local voice");
    await expect(
      studio.locator('button[data-kind="short-video"]'),
    ).toContainText("Install ffmpeg");

    controls.setReady();
    await page.reload();
    await openResearchStudio(page);
    await podcastCard.click();
    const config = page.getByRole("dialog", { name: "Generate Podcast" });
    const provider = config.getByLabel("Voice provider");
    await expect(provider.locator("option")).toHaveText([
      "Local",
      "ElevenLabs",
    ]);
    await expect(config.getByLabel("Local voice")).toHaveValue("piper-amy");
    await provider.selectOption("elevenlabs");
    await expect(config.getByLabel("ElevenLabs voice ID")).toHaveValue(
      ELEVENLABS_VOICE_ID,
    );
    await expect(config.getByLabel("Length").locator("option")).toHaveCount(3);
    await expect(config.getByLabel("Style").locator("option")).toHaveText([
      "Breakdown",
      "Debate",
      "Interview",
      "Recap",
    ]);
    // Recap is single-narrator, so the guest voice field leaves with it.
    await expect(config.getByLabel("Guest voice (optional)")).toBeVisible();
    await config.getByLabel("Style").selectOption("recap");
    await expect(config.getByLabel("Guest voice (optional)")).toHaveCount(0);
    await config.getByLabel("Style").selectOption("breakdown");
    await page.keyboard.press("Escape");
    await expect(podcastCard).toBeFocused();

    await podcastCard.click();
    await config.getByLabel("Style").selectOption("debate");
    await config.getByLabel("Guest voice (optional)").fill("eleven-guest");
    await config.getByRole("button", { name: /Draft for review Podcast/ }).click();
    expect(controls.createBodies.at(-1)?.renderConfig).toEqual({
      provider: "elevenlabs",
      voice: ELEVENLABS_VOICE_ID,
      length: "standard",
      voices: { host: ELEVENLABS_VOICE_ID, guest: "eleven-guest" },
      style: "debate",
    });
    let review = page.getByRole("dialog", {
      name: "Review before rendering",
    });
    await expect(review).toContainText(
      "An extracted finding for the podcast.",
    );
    await expect(review).toContainText("ElevenLabs");
    await expect(review).toContainText("eleven-guest");
    await expect(review).toContainText("debate");
    await review.getByRole("button", { name: "Keep draft" }).click();
    const row = studio.locator(".research-studio-row").first();
    await row.getByRole("button", { name: "Review draft" }).click();
    review = page.getByRole("dialog", { name: "Review before rendering" });
    await review.getByRole("button", { name: "Render media" }).click();
    await expect(row).toContainText("Waiting to render");
    await expect
      .poll(() => row.innerText(), { timeout: 20_000 })
      .toContain("Synthesizing");
    await expect
      .poll(() => row.innerText(), { timeout: 20_000 })
      .toContain("ready");
    await row.getByRole("button", { name: "↗ Open" }).click();
    const viewer = page.getByRole("dialog", { name: /Podcast —/ });
    await expect(viewer.locator("audio[controls]")).toBeVisible();
    await expect(viewer.getByRole("link", { name: /Download media/ })).toHaveAttribute(
      "href",
      /download=1/,
    );
  });

  test("defaults short videos to ElevenLabs Rachel at standard length", async ({
    page,
  }) => {
    const controls = await boot(page, { ready: true });
    const studio = page.locator(".research-studio");
    await studio.locator('button[data-kind="short-video"]').click();

    const config = page.getByRole("dialog", { name: "Generate Short video" });
    await expect(config.getByLabel("Voice provider")).toHaveValue("elevenlabs");
    await expect(config.getByLabel("ElevenLabs voice ID")).toHaveValue(
      ELEVENLABS_VOICE_ID,
    );
    await expect(config.getByLabel("Length")).toHaveValue("standard");

    await config
      .getByRole("button", { name: /Draft for review Short video/ })
      .click();
    expect(controls.createBodies.at(-1)).toEqual({
      familiarId: FAMILIAR_ID,
      kind: "short-video",
      sourceMissionId: MISSION_ID,
      renderConfig: {
        provider: "elevenlabs",
        voice: ELEVENLABS_VOICE_ID,
        length: "standard",
      },
    });
  });

  test("resumes drafts, retries failures, cancels progress, and opens both video players", async ({
    page,
  }) => {
    await boot(page, {
      ready: true,
      records: [
        generation("podcast", "draft", "kept-draft"),
        generation("podcast", "failed", "failed-podcast"),
        generation("long-video", "rendering", "long-progress"),
        generation("short-video", "ready", "short-ready"),
        generation("long-video", "ready", "long-ready"),
      ],
    });
    const studio = page.locator(".research-studio");

    const kept = studio.locator('[data-generation-id="kept-draft"]');
    await kept.getByRole("button", { name: "Review draft" }).click();
    await expect(
      page.getByRole("dialog", { name: "Review before rendering" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");

    const failed = studio.locator('[data-generation-id="failed-podcast"]');
    await failed.getByRole("button", { name: "Retry" }).click();
    const retryReview = page.getByRole("dialog", {
      name: "Review before rendering",
    });
    await expect(retryReview).toBeVisible();
    await expect(retryReview).toContainText("Local");
    await retryReview.getByRole("button", { name: "Keep draft" }).click();
    await expect(studio).not.toContainText("retry queued");

    const progress = studio.locator('[data-generation-id="long-progress"]');
    await expect(progress).toContainText("Synthesizing");
    await progress.getByRole("button", { name: "Cancel" }).click();
    await expect(progress).toContainText("cancelled");

    for (const id of ["short-ready", "long-ready"]) {
      const matching = studio.locator(`[data-generation-id="${id}"]`);
      await matching.getByRole("button", { name: "↗ Open" }).click();
      const viewer = page.getByRole("dialog").last();
      await expect(viewer.locator("video[controls]")).toBeVisible();
      await expect(
        viewer.getByRole("link", { name: /Download media/ }),
      ).toHaveAttribute("href", /download=1/);
      await viewer
        .getByRole("button", { name: "Close", exact: true })
        .click();
    }

    await failed.getByRole("button", { name: "✕ Remove" }).click();
    await failed.getByRole("button", { name: "Remove", exact: true }).click();
    await expect(failed).toHaveCount(0);
  });
});
