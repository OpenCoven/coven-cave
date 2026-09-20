import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";

export default function WikiNotFound() {
  return <EmptyState headline="Wiki or page not found" subtitle="Choose an available wiki to continue." actions={<Link className="focus-ring" href="/wikis">Browse wikis</Link>} />;
}
