export function researchRecommendationDisplayText(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^#{1,6}\s+/, "")
    .replace(/\*\*(?=\S)(.+?\S)\*\*/g, "$1")
    .replace(/__(?=\S)(.+?\S)__/g, "$1")
    .replace(/`(?=\S)(.+?\S)`/g, "$1");
}
