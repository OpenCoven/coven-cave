"use client";
import { Button } from "@/components/ui/button";

export default function WikiError({ reset }: { reset: () => void }) {
  return <main role="alert"><p>Couldn't load your wikis. Try again.</p><Button onClick={reset}>Retry</Button></main>;
}
