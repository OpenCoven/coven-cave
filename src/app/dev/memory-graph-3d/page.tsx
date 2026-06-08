import { notFound } from "next/navigation";
import { MemoryGraph3DSmoke } from "@/components/memory-graph-3d-smoke";

export const dynamic = "force-dynamic";

export default function MemoryGraph3DDevPage() {
  if (process.env.NODE_ENV === "production" && process.env.CAVE_TRACE_GRAPH_SMOKE !== "1") notFound();
  return <MemoryGraph3DSmoke />;
}
