// Explicit Research host contract. Keep exports scoped; never export *.
export {
  listKnowledgeEntries,
  selectKnowledgeForFamiliar,
  writeKnowledgeEntry,
} from "@/lib/server/knowledge-vault";
export type {
  KnowledgeEntry,
} from "@/lib/server/knowledge-vault";
