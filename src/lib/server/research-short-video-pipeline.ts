import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  RESEARCH_MEDIA_LENGTH_LIMITS,
  type ResearchGenerationContent,
  type ResearchGenerationStoryboardScene,
  type ResearchMediaRenderConfig,
} from "../research-generations.ts";
import type { ResearchMediaJobDefinition } from "./research-media-job-contract.ts";
import {
  publishResearchGenerationMediaFile,
  removeResearchGenerationMedia,
} from "./research-media-store.ts";
import {
  renderResearchVideoSequence,
  type ResearchVideoSequenceInput,
} from "./research-video-renderer.ts";

export type ShortVideoMediaJobInput = {
  familiarId: string;
  generationId: string;
  storyboard: ResearchGenerationStoryboardScene[];
  renderConfig: ResearchMediaRenderConfig;
};

export type ShortVideoPipelineDependencies = {
  renderVideoSequence?: typeof renderResearchVideoSequence;
  removeTemporary?: typeof rm;
};

export function createShortVideoMediaJobDefinition(
  input: ShortVideoMediaJobInput,
  dependencies: ShortVideoPipelineDependencies = {},
): ResearchMediaJobDefinition {
  const controller = new AbortController();
  const renderVideoSequence =
    dependencies.renderVideoSequence ?? renderResearchVideoSequence;
  const removeTemporary = dependencies.removeTemporary ?? rm;

  return {
    familiarId: input.familiarId,
    generationId: input.generationId,
    kill: () => controller.abort(),
    async run(context) {
      if (input.renderConfig.length === "extended") {
        throw new Error("short video length must be brief or standard");
      }
      const maxDurationMs =
        RESEARCH_MEDIA_LENGTH_LIMITS["short-video"][input.renderConfig.length]
          .maxDurationMs;
      const maxScenes =
        RESEARCH_MEDIA_LENGTH_LIMITS["short-video"][input.renderConfig.length]
          .maxScenes;
      if (input.storyboard.length > maxScenes) {
        throw new Error(
          `${input.renderConfig.length} short-video scene budget (${maxScenes}) exceeded`,
        );
      }
      const temporary = await mkdtemp(path.join(tmpdir(), "cave-short-video-"));
      const outputPath = path.join(temporary, "short-video.mp4");
      const onContextAbort = () => controller.abort(context.signal.reason);
      if (context.signal.aborted) onContextAbort();
      else context.signal.addEventListener("abort", onContextAbort, { once: true });
      try {
        const renderInput: ResearchVideoSequenceInput = {
          scenes: input.storyboard,
          provider: input.renderConfig.provider,
          voice: input.renderConfig.voice,
          maxDurationMs,
          outputPath,
          workDir: temporary,
          signal: controller.signal,
          reportStage: context.reportStage,
        };
        const rendered = await renderVideoSequence(renderInput);
        if (
          controller.signal.aborted ||
          context.isCancellationRequested()
        ) {
          throw new Error("short-video render cancelled");
        }
        if (
          rendered.provider !== input.renderConfig.provider ||
          rendered.voice !== input.renderConfig.voice
        ) {
          throw new Error("short-video renderer changed the selected voice");
        }
        const video = await publishResearchGenerationMediaFile({
          familiarId: input.familiarId,
          generationId: input.generationId,
          key: "short-video.mp4",
          mimeType: "video/mp4",
          sourcePath: outputPath,
          durationMs: rendered.durationMs,
        });
        if (
          controller.signal.aborted ||
          context.isCancellationRequested()
        ) {
          await removeResearchGenerationMedia(
            input.familiarId,
            input.generationId,
          );
          throw new Error("short-video render cancelled");
        }
        const content: Extract<
          ResearchGenerationContent,
          { kind: "short-video" }
        > = {
          kind: "short-video",
          storyboard: input.storyboard,
          video: {
            ...video,
            provider: rendered.provider,
            voice: rendered.voice,
          },
        };
        return { content };
      } catch (error) {
        if (
          controller.signal.aborted ||
          context.isCancellationRequested()
        ) {
          await removeResearchGenerationMedia(
            input.familiarId,
            input.generationId,
          );
          throw new Error("short-video render cancelled");
        }
        throw error;
      } finally {
        context.signal.removeEventListener("abort", onContextAbort);
        await removeTemporary(temporary, {
          recursive: true,
          force: true,
        }).catch((error: unknown) => {
          console.warn(
            `[research-short-video] temporary cleanup failed: ${
              error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300)
            }`,
          );
        });
      }
    },
  };
}
