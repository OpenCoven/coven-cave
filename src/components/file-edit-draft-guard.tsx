"use client";

// The unsaved-edit store, loaded on every page (#5781). It restores the
// drafts this tab persisted and installs the page's unload guard as a module
// side effect. Only the lazily loaded desk imported it, so after a reload on
// Home a tab still holding a draft in sessionStorage had no guard, and closing
// it lost the draft without a word. The module has no imports of its own.
import "@/lib/file-edit-drafts";

/** Renders nothing: importing the store is the point. */
export function FileEditDraftGuard() {
  return null;
}
