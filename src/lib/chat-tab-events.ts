/** Window event that asks the chat surface to select its Projects tab. */
export const CHAT_OPEN_PROJECTS_EVENT = "cave:chat-open-projects";

/** Window event that asks the Projects tab to expand and scroll a specific
 *  project into view. `detail.root` is the project's (un-normalized) root. */
export const CHAT_FOCUS_PROJECT_EVENT = "cave:chat-focus-project";
