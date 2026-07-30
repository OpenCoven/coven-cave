import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  RESEARCH_MEDIA_LENGTH_LIMITS,
  type ResearchGenerationContent,
  type ResearchGenerationVideoChapter,
  type ResearchMediaRenderConfig,
} from "../research-generations.ts";
import type { ResearchMediaJobDefinition } from "./research-media-job-contract.ts";
import {
  publishResearchGenerationMediaFile,
  removeResearchGenerationMedia,
} from "./research-media-store.ts";
import {
  renderResearchVideoSequence,
  runResearchVideoCommand,
  validateResearchVideoProbe,
  type ResearchVideoProbe,
} from "./research-video-renderer.ts";

export type LongVideoMediaJobInput = {
  familiarId: string;
  generationId: string;
  chapters: ResearchGenerationVideoChapter[];
  renderConfig: ResearchMediaRenderConfig;
};

export type LongVideoPipelineDependencies = {
  renderVideoSequence?: typeof renderResearchVideoSequence;
  runFfmpeg?: (
    args: string[],
    cwd: string,
    signal: AbortSignal,
  ) => Promise<void>;
  probeVideo?: (
    outputPath: string,
    cwd: string,
    signal: AbortSignal,
  ) => Promise<ResearchVideoProbe>;
  publishMedia?: typeof publishResearchGenerationMediaFile;
  removeMedia?: typeof removeResearchGenerationMedia;
  removeTemporary?: typeof rm;
};

async function defaultRunFfmpeg(
  args: string[],
  cwd: string,
  signal: AbortSignal,
): Promise<void> {
  await runResearchVideoCommand("ffmpeg", args, { cwd, signal });
}

async function defaultProbeVideo(
  outputPath: string,
  cwd: string,
  signal: AbortSignal,
): Promise<ResearchVideoProbe> {
  const result = await runResearchVideoCommand(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_streams",
      "-show_format",
      "-of",
      "json",
      outputPath,
    ],
    { cwd, signal },
  );
  return JSON.parse(result.stdout) as ResearchVideoProbe;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createLongVideoMediaJobDefinition(
  input: LongVideoMediaJobInput,
  dependencies: LongVideoPipelineDependencies = {},
): ResearchMediaJobDefinition {
  const controller = new AbortController();
  const renderVideoSequence =
    dependencies.renderVideoSequence ?? renderResearchVideoSequence;
  const runFfmpeg = dependencies.runFfmpeg ?? defaultRunFfmpeg;
  const probeVideo = dependencies.probeVideo ?? defaultProbeVideo;
  const publishMedia =
    dependencies.publishMedia ?? publishResearchGenerationMediaFile;
  const removeMedia =
    dependencies.removeMedia ?? removeResearchGenerationMedia;
  const removeTemporary = dependencies.removeTemporary ?? rm;

  return {
    familiarId: input.familiarId,
    generationId: input.generationId,
    kill: () => controller.abort(),
    async run(context) {
      const limits =
        RESEARCH_MEDIA_LENGTH_LIMITS["long-video"][input.renderConfig.length];
      if (input.chapters.length === 0) {
        throw new Error("long-video draft has no chapters");
      }
      if (input.chapters.length > limits.maxChapters) {
        throw new Error(
          `${input.renderConfig.length} long-video chapter budget (${limits.maxChapters}) exceeded`,
        );
      }
      const totalScenes = input.chapters.reduce(
        (total, chapter) => total + chapter.scenes.length,
        0,
      );
      if (totalScenes > limits.maxScenes) {
        throw new Error(
          `${input.renderConfig.length} long-video scene budget (${limits.maxScenes}) exceeded`,
        );
      }
      if (input.chapters.some((chapter) => chapter.scenes.length === 0)) {
        throw new Error("long-video chapters must contain at least one scene");
      }
      const temporary = await mkdtemp(
        path.join(tmpdir(), "cave-long-video-"),
      );
      const onContextAbort = () => controller.abort(context.signal.reason);
      if (context.signal.aborted) onContextAbort();
      else {
        context.signal.addEventListener("abort", onContextAbort, {
          once: true,
        });
      }
      const cancelled = () =>
        controller.signal.aborted || context.isCancellationRequested();
      try {
        const chapterPaths: string[] = [];
        let renderedDurationMs = 0;
        for (const [index, chapter] of input.chapters.entries()) {
          if (cancelled()) throw new Error("long-video render cancelled");
          const progress = {
            unit: "chapter" as const,
            current: index + 1,
            total: input.chapters.length,
            label: chapter.title,
          };
          await context.reportStage("scripting", progress);
          const chapterDirectory = path.join(
            temporary,
            `chapter-${String(index + 1).padStart(3, "0")}`,
          );
          const chapterPath = path.join(
            temporary,
            `chapter-${String(index + 1).padStart(3, "0")}.mp4`,
          );
          try {
            const remainingDurationMs =
              limits.maxDurationMs - renderedDurationMs;
            if (remainingDurationMs <= 0) {
              throw new Error("long-video chapters exceed the duration cap");
            }
            const rendered = await renderVideoSequence({
              scenes: chapter.scenes,
              provider: input.renderConfig.provider,
              voice: input.renderConfig.voice,
              maxDurationMs: remainingDurationMs,
              outputPath: chapterPath,
              workDir: chapterDirectory,
              signal: controller.signal,
              reportStage: (stage) => context.reportStage(stage, progress),
            });
            if (
              rendered.provider !== input.renderConfig.provider ||
              rendered.voice !== input.renderConfig.voice
            ) {
              throw new Error(
                "long-video renderer changed the selected voice",
              );
            }
            renderedDurationMs += rendered.durationMs;
            if (renderedDurationMs > limits.maxDurationMs) {
              throw new Error("long-video chapters exceed the duration cap");
            }
          } catch (error) {
            if (cancelled()) throw new Error("long-video render cancelled");
            throw new Error(
              `long-video chapter ${index + 1} (${chapter.title}) failed: ${errorText(error)}`,
            );
          }
          chapterPaths.push(chapterPath);
        }

        if (cancelled()) throw new Error("long-video render cancelled");
        const lastChapter = input.chapters.at(-1)!;
        const finalProgress = {
          unit: "chapter" as const,
          current: input.chapters.length,
          total: input.chapters.length,
          label: lastChapter.title,
        };
        await context.reportStage("encoding", finalProgress);
        const manifestPath = path.join(temporary, "chapters.txt");
        await writeFile(
          manifestPath,
          `${chapterPaths
            .map((chapterPath) => `file '${path.basename(chapterPath)}'`)
            .join("\n")}\n`,
          "utf8",
        );
        const outputPath = path.join(temporary, "long-video.mp4");
        await runFfmpeg(
          [
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            path.basename(manifestPath),
            "-c",
            "copy",
            "-movflags",
            "+faststart",
            outputPath,
          ],
          temporary,
          controller.signal,
        );
        if (cancelled()) throw new Error("long-video render cancelled");
        const probe = await probeVideo(
          outputPath,
          temporary,
          controller.signal,
        );
        const durationMs = validateResearchVideoProbe(
          probe,
          limits.maxDurationMs,
        );
        const video = await publishMedia({
          familiarId: input.familiarId,
          generationId: input.generationId,
          key: "long-video.mp4",
          mimeType: "video/mp4",
          sourcePath: outputPath,
          durationMs,
        });
        if (cancelled()) {
          throw new Error("long-video render cancelled");
        }
        const content: Extract<
          ResearchGenerationContent,
          { kind: "long-video" }
        > = {
          kind: "long-video",
          chapters: input.chapters,
          video: {
            ...video,
            provider: input.renderConfig.provider,
            voice: input.renderConfig.voice,
          },
        };
        return { content };
      } catch (error) {
        if (cancelled()) {
          await removeMedia(input.familiarId, input.generationId);
          throw new Error("long-video render cancelled");
        }
        throw error;
      } finally {
        context.signal.removeEventListener("abort", onContextAbort);
        await removeTemporary(temporary, {
          recursive: true,
          force: true,
        }).catch((error: unknown) => {
          console.warn(
            `[research-long-video] temporary cleanup failed: ${
              error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300)
            }`,
          );
        });
      }
    },
  };
}
