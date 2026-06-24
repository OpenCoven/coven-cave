import { notFound } from "next/navigation";
import { TraceGraph3DSmoke } from "@/components/trace-graph-3d-smoke";

export const dynamic = "force-dynamic";

export default function TraceGraph3DDevPage() {
  if (process.env.NODE_ENV === "production" && process.env.CAVE_TRACE_GRAPH_SMOKE !== "1") notFound();
  return <TraceGraph3DSmoke />;
}
