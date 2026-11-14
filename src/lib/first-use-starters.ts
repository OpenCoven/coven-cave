/** Suggestions fill an editable draft; choosing one never dispatches work. */
export const FIRST_USE_STARTERS = [
  { icon: "ph:folder" as const, title: "Map this project", description: "Get the lay of the land and a useful next step.", prompt: "Summarize this project and suggest one useful next step. Do not change files." },
  { icon: "ph:sparkle" as const, title: "Find a little potential", description: "Spot one small improvement worth exploring.", prompt: "Suggest a small improvement and explain how I could verify it. Do not change files." },
  { icon: "ph:file-text" as const, title: "Make a plan", description: "Turn a rough idea into a clear way forward.", prompt: "Help me plan a small change to this project. Ask what I want to achieve before suggesting implementation." },
];
