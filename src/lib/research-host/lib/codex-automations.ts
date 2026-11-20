// Explicit Research host contract. Keep exports scoped; never export *.
export {
  createResearchAutomation as createCodexAutomation,
  getResearchAutomation as getCodexAutomation,
  updateResearchAutomation as updateCodexAutomation,
} from "@/lib/server/research-automations";
