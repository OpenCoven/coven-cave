import {
  isResearchGenerationMediaKind,
  validateResearchMediaRenderConfig,
  type ResearchGeneration,
} from "../research-generations.ts";
import type { ResearchMediaJobDefinition } from "./research-media-job-contract.ts";
import {
  createLongVideoMediaJobDefinition,
  type LongVideoMediaJobInput,
} from "./research-long-video-pipeline.ts";
import {
  createPodcastMediaJobDefinition,
  type PodcastMediaJobInput,
} from "./research-podcast-pipeline.ts";
import {
  createShortVideoMediaJobDefinition,
  type ShortVideoMediaJobInput,
} from "./research-short-video-pipeline.ts";

export type ResearchMediaJobFactoryDependencies = {
  createPodcast?: (
    input: PodcastMediaJobInput,
  ) => ResearchMediaJobDefinition;
  createShortVideo?: (
    input: ShortVideoMediaJobInput,
  ) => ResearchMediaJobDefinition;
  createLongVideo?: (
    input: LongVideoMediaJobInput,
  ) => ResearchMediaJobDefinition;
};

function matchingMediaContent(generation: ResearchGeneration) {
  if (
    !generation.content ||
    generation.content.kind !== generation.kind
  ) {
    throw new Error("media generation requires matching media content");
  }
  return generation.content;
}

/**
 * Rebuild a render job exclusively from the durable generation record.
 * Readiness belongs at the API boundary; this factory never selects defaults.
 */
export function createResearchMediaJobDefinition(
  generation: ResearchGeneration,
  dependencies: ResearchMediaJobFactoryDependencies = {},
): ResearchMediaJobDefinition {
  if (!isResearchGenerationMediaKind(generation.kind)) {
    throw new Error("generation is not a renderable media generation");
  }
  const validatedConfig = validateResearchMediaRenderConfig(
    generation.kind,
    generation.renderConfig,
  );
  if (!validatedConfig.ok) {
    throw new Error(
      `media generation has invalid render configuration: ${validatedConfig.error}`,
    );
  }
  const renderConfig = validatedConfig.value;
  const content = matchingMediaContent(generation);
  const common = {
    familiarId: generation.familiarId,
    generationId: generation.id,
    renderConfig,
  };

  switch (generation.kind) {
    case "podcast": {
      if (content.kind !== "podcast") {
        throw new Error("media generation requires matching media content");
      }
      return (dependencies.createPodcast ?? createPodcastMediaJobDefinition)({
        ...common,
        script: content.script,
      });
    }
    case "short-video": {
      if (content.kind !== "short-video") {
        throw new Error("media generation requires matching media content");
      }
      return (
        dependencies.createShortVideo ?? createShortVideoMediaJobDefinition
      )({
        ...common,
        storyboard: content.storyboard,
      });
    }
    case "long-video": {
      if (content.kind !== "long-video") {
        throw new Error("media generation requires matching media content");
      }
      if (content.chapters.length === 0) {
        throw new Error("long-video generation requires at least one chapter");
      }
      return (
        dependencies.createLongVideo ?? createLongVideoMediaJobDefinition
      )({
        ...common,
        chapters: content.chapters,
      });
    }
  }
}
