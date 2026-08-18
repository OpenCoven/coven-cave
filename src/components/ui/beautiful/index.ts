/**
 * Beautiful UI — AI-native interface primitives.
 *
 * Vendored from https://www.beautifului.dev (MIT, © Turbo). See
 * `docs/beautiful-ui.md` for what was changed on the way in, and
 * `src/styles/globals/beautiful-ui.css` for the token adapter that maps the
 * upstream design vocabulary onto Cave's.
 *
 * ⚠️ These are upstream's SHOWCASE compositions: most carry their own fixture
 * data and take no props, so they are reference implementations rather than
 * drop-in primitives. Parameterize one before using it on a real surface —
 * `cave-qq3dt` tracks that work, and the gallery at `/aesthetic/beautiful`
 * renders them all as they stand.
 */

export { ApprovalCard } from "./ApprovalCard";
export { ChatComposer } from "./ChatComposer";
export { CodeBlock } from "./CodeBlock";
export { ContextCards } from "./ContextCards";
export { DiffTable } from "./DiffTable";
export { FilterTable } from "./FilterTable";
export { FineTuneCard } from "./FineTuneCard";
export { InsightCards } from "./InsightCards";
export { LoadingState } from "./LoadingState";
export { PromptBar } from "./PromptBar";
export { RecommendationCard } from "./RecommendationCard";
export { RecordsTable } from "./RecordsTable";
export { SearchList } from "./SearchList";
export { SelectionActions } from "./SelectionActions";
export { SidebarNav } from "./SidebarNav";
export { StreamingText } from "./StreamingText";
export { TaskRows } from "./TaskRows";
export { ThinkingState } from "./ThinkingState";
export { ToolChips } from "./ToolChips";

export { Shimmer, StreamText } from "./atoms";
