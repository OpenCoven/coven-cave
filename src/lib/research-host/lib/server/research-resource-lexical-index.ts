// Explicit Research host contract. Keep exports scoped; never export *.
export {
  RESEARCH_LEXICAL_CHUNKER_VERSION,
  chunkResearchResourceUtf8,
  openResearchResourceLexicalIndex,
} from "@/lib/server/research-resource-lexical-index";
export type {
  ResearchLexicalAuthority,
  ResearchLexicalSearchHit,
  ResearchResourceLexicalIndex,
} from "@/lib/server/research-resource-lexical-index";
