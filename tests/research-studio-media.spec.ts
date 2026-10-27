import { expect, test, type Locator, type Page } from "@playwright/test";
import { createServer, request as proxyRequest, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import type { Socket } from "node:net";
import { DEFAULT_ELEVENLABS_VOICE_ID } from "../src/lib/voice/elevenlabs-shared";

const FAMILIAR_ID = "rida";
const MISSION_ID = "m-media";
const ELEVENLABS_VOICE_ID = DEFAULT_ELEVENLABS_VOICE_ID;
const ELEVENLABS_GUEST_VOICE_ID = "AZnzlk1XvdvUeBnXmlld";
const now = new Date().toISOString();

function createSilentWav() {
  const sampleRate = 8_000;
  const dataBytes = 160;
  const wav = Buffer.alloc(44 + dataBytes);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + dataBytes, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(dataBytes, 40);
  return wav;
}

// One black 16x16 H.264 frame. Real media bytes keep the browser from firing
// the viewer's playback-error path before the assertions can inspect it.
const BLACK_MP4 = Buffer.from(
  "AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAMtbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAAHgAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAld0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAAHgAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAABAAAAAQAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAB4AAAAAAABAAAAAAHPbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAAAyAAAABgBVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABem1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAATpzdGJsAAAAtnN0c2QAAAAAAAAAAQAAAKZhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAABAAEABIAAAASAAAAAAAAAABFUxhdmM2Mi4yOC4xMDEgbGlieDI2NAAAAAAAAAAAAAAAGP//AAAALGF2Y0MBQsAK/+EAFWdCwAraewEQAAADABAAAAMDIPEiagEABGjOD8gAAAAQcGFzcAAAAAEAAAABAAAAFGJ0cnQAAAAAAAClGgAAAAAAAAAYc3R0cwAAAAAAAAABAAAAAwAAAgAAAAAUc3RzcwAAAAAAAAABAAAAAQAAABxzdHNjAAAAAAAAAAEAAAABAAAAAwAAAAEAAAAgc3RzegAAAAAAAAAAAAAAAwAAAmgAAAAJAAAACQAAABRzdGNvAAAAAAAAAAEAAANdAAAAYnVkdGEAAABabWV0YQAAAAAAAAAhaGRscgAAAAAAAAAAbWRpcmFwcGwAAAAAAAAAAAAAAAAtaWxzdAAAACWpdG9vAAAAHWRhdGEAAAABAAAAAExhdmY2Mi4xMi4xMDEAAAAIZnJlZQAAAoJtZGF0AAACVgYF//9S3EXpvebZSLeWLNgg2SPu73gyNjQgLSBjb3JlIDE2NSByMzIyMiBiMzU2MDVhIC0gSC4yNjQvTVBFRy00IEFWQyBjb2RlYyAtIENvcHlsZWZ0IDIwMDMtMjAyNSAtIGh0dHA6Ly93d3cudmlkZW9sYW4ub3JnL3gyNjQuaHRtbCAtIG9wdGlvbnM6IGNhYmFjPTAgcmVmPTEgZGVibG9jaz0wOi0zOi0zIGFuYWx5c2U9MDowIG1lPWRpYSBzdWJtZT0wIHBzeT0xIHBzeV9yZD0yLjAwOjAuNzAgbWl4ZWRfcmVmPTAgbWVfcmFuZ2U9MTYgY2hyb21hX21lPTEgdHJlbGxpcz0wIDh4OGRjdD0wIGNxbT0wIGRlYWR6b25lPTIxLDExIGZhc3RfcHNraXA9MSBjaHJvbWFfcXBfb2Zmc2V0PTAgdGhyZWFkcz0xIGxvb2thaGVhZF90aHJlYWRzPTEgc2xpY2VkX3RocmVhZHM9MCBucj0wIGRlY2ltYXRlPTEgaW50ZXJsYWNlZD0wIGJsdXJheV9jb21wYXQ9MCBjb25zdHJhaW5lZF9pbnRyYT0wIGJmcmFtZXM9MCB3ZWlnaHRwPTAga2V5aW50PTI1MCBrZXlpbnRfbWluPTI1IHNjZW5lY3V0PTAgaW50cmFfcmVmcmVzaD0wIHJjPWNyZiBtYnRyZWU9MCBjcmY9MjMuMCBxY29tcD0wLjYwIHFwbWluPTAgcXBtYXg9NjkgcXBzdGVwPTQgaXBfcmF0aW89MS40MCBhcT0wAIAAAAAKZYiEOiYoAAkC4AAAAAVBmiAmlAAAAAVBmkAqlA==",
  "base64",
);
const SILENT_WAV = createSilentWav();

// Browser download managers bypass page.route. Serve real fixture bytes over
// loopback so playback and completed downloads exercise actual browser I/O.
let mediaServer: Server;
let mediaOrigin: string;
const mediaSockets = new Set<Socket>();
test.beforeAll(async ({}, testInfo) => {
  const upstreamOrigin = new URL(String(testInfo.project.use.baseURL));
  mediaServer = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname !== "/api/research/generations/media") {
      // Request targets supply only a path; the connection authority always
      // comes from trusted Playwright configuration, even for absolute URLs.
      const upstream = proxyRequest({
        protocol: upstreamOrigin.protocol,
        hostname: upstreamOrigin.hostname,
        port: upstreamOrigin.port,
        path: `${url.pathname}${url.search}`,
        method: request.method,
        headers: { ...request.headers, host: upstreamOrigin.host },
      }, upstreamResponse => {
        response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
        upstreamResponse.pipe(response);
      });
      upstream.on("error", () => {
        if (!response.headersSent) response.writeHead(502);
        response.end();
      });
      response.once("close", () => upstream.destroy());
      request.pipe(upstream);
      return;
    }
    const podcast = url.searchParams.get("kind") === "podcast";
    const body = podcast ? SILENT_WAV : BLACK_MP4;
    response.writeHead(200, {
      "content-type": podcast ? "audio/wav" : "video/mp4",
      "content-length": String(body.length),
      ...(url.searchParams.get("download") === "1"
        ? { "content-disposition": `attachment; filename="${podcast ? "podcast.wav" : "video.mp4"}"` }
        : {}),
    });
    response.end(body);
  });
  mediaServer.on("connection", socket => {
    mediaSockets.add(socket);
    socket.once("close", () => mediaSockets.delete(socket));
  });
  // Next's development RSC debug channel uses HMR. Forward its upgrade too:
  // serving the document and assets alone leaves hydration waiting forever.
  mediaServer.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const upstream = proxyRequest({
      protocol: upstreamOrigin.protocol,
      hostname: upstreamOrigin.hostname,
      port: upstreamOrigin.port,
      path: `${url.pathname}${url.search}`,
      method: request.method,
      headers: { ...request.headers, host: upstreamOrigin.host },
    });
    upstream.once("upgrade", (response, upstreamSocket, upstreamHead) => {
      socket.write(`HTTP/${response.httpVersion} ${response.statusCode} ${response.statusMessage}\r\n`);
      for (let index = 0; index < response.rawHeaders.length; index += 2) {
        socket.write(`${response.rawHeaders[index]}: ${response.rawHeaders[index + 1]}\r\n`);
      }
      socket.write("\r\n");
      if (upstreamHead.length) socket.write(upstreamHead);
      if (head.length) upstreamSocket.write(head);
      upstreamSocket.on("error", () => socket.destroy());
      upstreamSocket.once("close", () => socket.destroy());
      socket.once("close", () => upstreamSocket.destroy());
      upstreamSocket.pipe(socket).pipe(upstreamSocket);
    });
    upstream.once("response", response => {
      response.resume();
      socket.destroy();
    });
    upstream.once("error", () => socket.destroy());
    socket.on("error", () => upstream.destroy());
    socket.once("close", () => upstream.destroy());
    upstream.end();
  });
  await new Promise<void>(resolve => mediaServer.listen(0, "127.0.0.1", resolve));
  const address = mediaServer.address();
  if (!address || typeof address === "string") throw new Error("Media fixture did not bind");
  mediaOrigin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => {
  if (!mediaServer) return;
  for (const socket of mediaSockets) socket.destroy();
  mediaServer.closeAllConnections();
  await new Promise<void>((resolve, reject) => mediaServer.close(error => error ? reject(error) : resolve()));
});

test("media fixture keeps absolute and network-path targets on its configured upstream", async () => {
  const unexpectedRequests: string[] = [];
  const otherServer = createServer((request, response) => {
    unexpectedRequests.push(request.url ?? "");
    response.end("Unexpected upstream");
  });
  await new Promise<void>(resolve => otherServer.listen(0, "127.0.0.1", resolve));
  try {
    const address = otherServer.address();
    if (!address || typeof address === "string") throw new Error("Origin probe did not bind");
    const authority = `127.0.0.1:${address.port}`;
    for (const target of [`http://${authority}/proxy-origin-probe`, `//${authority}/proxy-origin-probe`, `/\\${authority}/proxy-origin-probe`]) {
      await new Promise<void>((resolve, reject) => {
        const request = proxyRequest(mediaOrigin, { path: target }, response => {
          response.resume();
          response.once("end", resolve);
          response.once("error", reject);
        });
        request.once("error", reject);
        request.end();
      });
    }
    expect(unexpectedRequests).toEqual([]);
  } finally {
    otherServer.closeAllConnections();
    await new Promise<void>((resolve, reject) => otherServer.close(error => error ? reject(error) : resolve()));
  }
});


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
  await page.goto(mediaOrigin);
  await page.locator("#shell-main-content").waitFor({ timeout: 60_000 });
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
  await page.route("**/api/voice/elevenlabs/catalog", (route) =>
    route.fulfill({
      json: {
        ok: true,
        voices: [
          {
            id: ELEVENLABS_VOICE_ID,
            name: "Rachel",
            category: "premade",
          },
          {
            id: ELEVENLABS_GUEST_VOICE_ID,
            name: "Domi",
            category: "premade",
          },
        ],
        models: [],
      },
    }),
  );
  await page.route(/\/api\/roles(?:\?|$)/, (route) =>
    route.fulfill({ json: { roles: [] } }),
  );
  // This fixture's random-port proxy serves media bytes; all Research server
  // state is mocked. Keep capability discovery on that same fixture boundary
  // rather than forwarding its foreign-port Referer to the real local API.
  await page.route("**/api/research/capability", (route) =>
    route.fulfill({ json: { ok: true, available: true, enabled: true, reason: "available" } }),
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
      // Both native playback and downloads use the same real fixture bytes.
      if (url.pathname.endsWith("/media")) return route.continue();
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
      // Playback resolves a scoped URL before the native media request.
      if (url.pathname.endsWith("/media-ticket")) {
        const id = url.searchParams.get("id") ?? "";
        const target = records.get(id);
        if (!target || target.status !== "ready") {
          await route.fulfill({
            status: 404,
            json: { ok: false, error: "media not found" },
          });
          return;
        }
        const params = new URLSearchParams({
          familiarId: FAMILIAR_ID,
          id,
          mediaTicket: "e2e-ticket",
          kind: target.kind,
        });
        await route.fulfill({
          json: {
            ok: true,
            mediaUrl: `/api/research/generations/media?${params}`,
          },
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

async function verifyPlaybackAndDownload(page: Page, viewer: Locator) {
  const player = viewer.locator("audio, video").first();
  // The viewer deliberately preloads metadata; WebKit waits for play before
  // fetching playable data. Check both stages in their actual order.
  await expect.poll(() => player.evaluate(node => (node as HTMLMediaElement).readyState)).toBeGreaterThanOrEqual(1);
  const tabKey = page.context().browser()?.browserType().name() === "webkit" ? "Alt+Tab" : "Tab";
  await viewer.getByLabel("Close", { exact: true }).focus();
  for (let index = 0; index < 16 && !await player.evaluate((node) => node === document.activeElement); index += 1) {
    await page.keyboard.press(tabKey);
  }
  await expect(player).toBeFocused();
  await player.evaluate(async node => {
    const media = node as HTMLMediaElement;
    media.muted = true;
    await media.play();
  });
  await expect.poll(() => player.evaluate(node => (node as HTMLMediaElement).readyState)).toBeGreaterThanOrEqual(2);
  await expect.poll(() => player.evaluate(node => (node as HTMLMediaElement).currentTime)).toBeGreaterThan(0);
  const download = page.waitForEvent("download");
  await viewer.getByRole("link", { name: /Download media/ }).click();
  const completedDownload = await download;
  expect(await completedDownload.failure()).toBeNull();
  const downloadedPath = await completedDownload.path();
  expect(downloadedPath).not.toBeNull();
  const audio = await player.evaluate(node => node.tagName === "AUDIO");
  expect(await readFile(downloadedPath!)).toEqual(audio ? SILENT_WAV : BLACK_MP4);
}

test.use({ serviceWorkers: "block" });

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
    // Reload mounts Studio before its asynchronous provider check completes.
    // Disabled buttons cannot receive keyboard focus or activate on Enter.
    await expect(podcastCard).toBeEnabled();
    await podcastCard.focus();
    await expect(podcastCard).toBeFocused();
    await page.keyboard.press("Enter");
    const config = page.getByRole("dialog", { name: "Generate Podcast" });
    const provider = config.getByLabel("Voice provider");
    await expect(provider.locator("option")).toHaveText([
      "Local",
      "ElevenLabs",
    ]);
    await expect(config.getByLabel("Local voice")).toHaveValue("piper-amy");
    await provider.selectOption("elevenlabs");
    await expect(config.getByLabel("Host voice")).toContainText("Rachel");
    const hostVoice = config.getByRole("button", { name: "Host voice", exact: true });
    await hostVoice.focus();
    await page.keyboard.press("Enter");
    const voiceMenu = page.getByRole("menu", { name: "Host voice options" });
    await expect(voiceMenu).toBeVisible();
    await expect(voiceMenu.getByRole("menuitemradio").first()).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(voiceMenu.getByRole("menuitemradio").nth(1)).toBeFocused();
    await expect.poll(() => voiceMenu.evaluate((node) => node.contains(document.activeElement))).toBe(true);
    await page.keyboard.press("Escape");
    await expect(voiceMenu).toHaveCount(0);
    await expect(config).toBeVisible();
    await expect(hostVoice).toBeFocused();
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

    await podcastCard.focus();
    await page.keyboard.press("Enter");
    await config.getByLabel("Style").selectOption("debate");
    await config.getByLabel("Guest voice (optional)").click();
    await page
      .getByRole("menuitemradio", { name: /Domi/ })
      .click();
    await config.getByRole("button", { name: /Draft for review Podcast/ }).click();
    expect(controls.createBodies.at(-1)?.renderConfig).toEqual({
      provider: "elevenlabs",
      voice: ELEVENLABS_VOICE_ID,
      length: "standard",
      voices: {
        host: ELEVENLABS_VOICE_ID,
        guest: ELEVENLABS_GUEST_VOICE_ID,
      },
      style: "debate",
    });
    let review = page.getByRole("dialog", {
      name: "Review before rendering",
    });
    await expect(review).toContainText(
      "An extracted finding for the podcast.",
    );
    await expect(review).toContainText("ElevenLabs");
    await expect(review).toContainText(ELEVENLABS_GUEST_VOICE_ID);
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
    await verifyPlaybackAndDownload(page, viewer);
  });

  test("creates, reviews, renders, plays, and downloads a short video", async ({
    page,
    browserName,
  }) => {
    const controls = await boot(page, { ready: true });
    const studio = page.locator(".research-studio");
    const shortVideoCard = studio.locator('button[data-kind="short-video"]');
    await expect(shortVideoCard).toBeEnabled();
    await expect(shortVideoCard).toHaveCSS("cursor", "pointer");
    await studio.locator('button[data-kind="podcast"]').focus();
    await page.keyboard.press(browserName === "webkit" ? "Alt+Tab" : "Tab");
    await expect(shortVideoCard).toBeFocused();
    await expect(shortVideoCard).toHaveCSS("outline-style", "solid");
    await shortVideoCard.click();

    const config = page.getByRole("dialog", { name: "Generate Short video" });
    await expect(config.getByLabel("Voice provider")).toHaveValue("elevenlabs");
    await expect(config.getByLabel("Host voice")).toContainText("Rachel");
    await expect(config.getByLabel("Length")).toHaveValue("standard");
    await config.getByLabel("Research run").focus();
    await page.keyboard.press(browserName === "webkit" ? "Alt+Tab" : "Tab");
    await expect(config.getByLabel("Directions (optional)")).toBeFocused();
    await expect(config.getByLabel("Directions (optional)")).toHaveCSS(
      "outline-style",
      "solid",
    );

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

    const review = page.getByRole("dialog", {
      name: "Review before rendering",
    });
    await expect(review).toContainText("An extracted finding for the video.");
    await review.getByRole("button", { name: "Render media" }).click();

    const row = studio.locator('[data-generation-id="gen-short-video-1"]');
    await expect(row).toContainText("Waiting to render");
    await expect
      .poll(() => row.innerText(), { timeout: 20_000 })
      .toContain("Synthesizing");
    await expect
      .poll(() => row.innerText(), { timeout: 20_000 })
      .toContain("ready");
    await row.getByRole("button", { name: "↗ Open" }).click();

    const viewer = page.getByRole("dialog", { name: /Short video —/ });
    await expect(viewer.locator("video[controls]")).toBeVisible();
    await expect(
      viewer.getByRole("link", { name: /Download media/ }),
    ).toHaveAttribute("href", /download=1/);
    await verifyPlaybackAndDownload(page, viewer);
  });

  test("creates, reviews, renders, plays, and downloads a long video", async ({
    page,
    browserName,
  }) => {
    const controls = await boot(page, { ready: true });
    const studio = page.locator(".research-studio");
    const longVideoCard = studio.locator('button[data-kind="long-video"]');
    await expect(longVideoCard).toBeEnabled();
    await expect(longVideoCard).toHaveCSS("cursor", "pointer");
    await studio.locator('button[data-kind="short-video"]').focus();
    await page.keyboard.press(browserName === "webkit" ? "Alt+Tab" : "Tab");
    await expect(longVideoCard).toBeFocused();
    await expect(longVideoCard).toHaveCSS("outline-style", "solid");
    await longVideoCard.click();

    const config = page.getByRole("dialog", { name: "Generate Long video" });
    await expect(config.getByLabel("Voice provider")).toHaveValue("local");
    await expect(config.getByLabel("Local voice")).toBeVisible();
    await expect(config.getByLabel("Length")).toHaveValue("standard");
    await config.getByLabel("Research run").focus();
    await page.keyboard.press(browserName === "webkit" ? "Alt+Tab" : "Tab");
    await expect(config.getByLabel("Directions (optional)")).toBeFocused();
    await expect(config.getByLabel("Directions (optional)")).toHaveCSS(
      "outline-style",
      "solid",
    );

    await config
      .getByRole("button", { name: /Draft for review Long video/ })
      .click();
    expect(controls.createBodies.at(-1)).toEqual({
      familiarId: FAMILIAR_ID,
      kind: "long-video",
      sourceMissionId: MISSION_ID,
      renderConfig: {
        provider: "local",
        voice: "piper-amy",
        length: "standard",
      },
    });

    const review = page.getByRole("dialog", {
      name: "Review before rendering",
    });
    await expect(review).toContainText("An extracted finding for the video.");
    await review.getByRole("button", { name: "Render media" }).click();

    const row = studio.locator('[data-generation-id="gen-long-video-1"]');
    await expect(row).toContainText("Waiting to render");
    await expect
      .poll(() => row.innerText(), { timeout: 20_000 })
      .toContain("Synthesizing");
    await expect
      .poll(() => row.innerText(), { timeout: 20_000 })
      .toContain("ready");
    await row.getByRole("button", { name: "↗ Open" }).click();

    const viewer = page.getByRole("dialog", { name: /Long video —/ });
    await expect(viewer.locator("video[controls]")).toBeVisible();
    await expect(
      viewer.getByRole("link", { name: /Download media/ }),
    ).toHaveAttribute("href", /download=1/);
    await verifyPlaybackAndDownload(page, viewer);
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
        .getByLabel("Close", { exact: true })
        .click();
    }

    await failed.getByRole("button", { name: "✕ Remove" }).click();
    await failed.getByRole("button", { name: "Remove", exact: true }).click();
    await expect(failed).toHaveCount(0);
  });
});

test("blog directions keep keyboard focus and submit all editorial choices", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await boot(page);
  let submitted: Record<string, unknown> | undefined;
  await page.route("**/api/research/generations", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    submitted = route.request().postDataJSON();
    await route.fulfill({ status: 409, json: { ok: false, error: "Fixture keeps the draft open for inspection." } });
  });
  await page.locator('.research-studio button[data-kind="blog"]').click();
  const config = page.getByRole("dialog", { name: "Generate Blog / article" });
  await expect(config).toBeVisible();
  for (const [label, choice] of [["Visual direction", "Diagrams"], ["Tone", "Technical"], ["Audience", "Researchers"]]) {
    const trigger = config.getByRole("button", { name: label, exact: true });
    await trigger.focus();
    await page.keyboard.press("Enter");
    const picker = page.getByRole("dialog", { name: label, exact: true });
    await picker.getByRole("checkbox", { name: choice, exact: true }).check();
    await page.keyboard.press("Escape");
    await expect(picker).not.toBeVisible();
    await expect(config).toBeVisible();
    await expect(trigger).toBeFocused();
  }
  await config.getByRole("button", { name: "Audience", exact: true }).click();
  const audience = page.getByRole("dialog", { name: "Audience", exact: true });
  await audience.getByRole("textbox", { name: "Search audience" }).fill("Platform engineers");
  await page.keyboard.press("Enter");
  await expect(audience.getByRole("checkbox", { name: "Platform engineers" })).toBeChecked();
  await page.keyboard.press("Escape");
  await config.getByLabel("Directions (optional)", { exact: true }).fill("x".repeat(5000));
  await expect(config.getByRole("button", { name: /Generate Blog/ })).toBeDisabled();
  await expect(config.getByRole("alert")).toContainText("5,000");
  await config.getByLabel("Directions (optional)", { exact: true }).fill("Keep citations.");
  for (const [theme, mode] of [["coven", "dark"], ["coven", "light"], ["tide", "dark"]]) {
    await page.evaluate(({ theme, mode }) => {
      document.documentElement.dataset.theme = theme;
      document.documentElement.dataset.mode = mode;
    }, { theme, mode });
    await expect(config).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`blog-${theme}-${mode}.png`), animations: "disabled" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect(page.locator("html")).toHaveAttribute("data-mode", mode);
  }
  await config.getByRole("button", { name: /Generate Blog/ }).click();
  await expect.poll(() => submitted?.directions).toBe('Keep citations.\n\nVisual direction: ["Diagrams"]\n\nTone: ["Technical"]\n\nAudience: ["Researchers","Platform engineers"]');
  await expect(config.getByRole("alert")).toHaveText("Fixture keeps the draft open for inspection.");
  await expect(config.getByRole("button", { name: "Audience", exact: true })).toContainText("Platform engineers");
});


test("blog directions fit a narrow viewport", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await boot(page);
  await page.locator('.research-studio button[data-kind="blog"]').click();
  const config = page.getByRole("dialog", { name: "Generate Blog / article" });
  await config.getByRole("button", { name: "Audience", exact: true }).focus();
  await page.keyboard.press("Enter");
  const picker = page.getByRole("dialog", { name: "Audience", exact: true });
  await picker.getByRole("checkbox", { name: "Researchers", exact: true }).check();
  const bounds = await picker.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: testInfo.outputPath("blog-narrow-picker.png") });
  await page.keyboard.press("Escape");
  await expect(config.getByRole("button", { name: "Audience", exact: true })).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath("blog-narrow.png") });
});
