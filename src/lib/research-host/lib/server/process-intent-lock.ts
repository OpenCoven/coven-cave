// Explicit Research host contract. Keep exports scoped; never export *.
export {
  acquireProcessIntentLock,
  withProcessIntentLock,
} from "@/lib/server/process-intent-lock";
