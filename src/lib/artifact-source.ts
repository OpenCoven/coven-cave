import type { ArtifactKind } from "./canvas-artifacts.ts";

export type ArtifactSource = {
  code: string;
  language: "html" | "tsx";
  label: "HTML" | "React · TSX";
};

export function artifactSource(code: string, kind?: ArtifactKind): ArtifactSource {
  if (kind === "react") {
    return { code, language: "tsx", label: "React · TSX" };
  }
  return { code, language: "html", label: "HTML" };
}
