"use client";

/**
 * MdEditorVisual — the WYSIWYG (VISUAL) mode of the MdEditor, powered by
 * Milkdown Crepe (MIT). Notion-like editing of the markdown *body*; the
 * title/tags frontmatter header is owned by the MdEditor shell.
 *
 * The Crepe instance captures `defaultValue` at mount — parents remount this
 * component (via `key`) when the underlying document identity changes.
 * Loaded through next/dynamic (ssr: false) so ProseMirror never runs on the
 * server and the chunk only ships when an editor mounts.
 */

import { useEffect, useRef } from "react";
import { Crepe } from "@milkdown/crepe";
import { caveCodeMirrorTheme } from "@/components/code-editor-theme";
import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/frame-dark.css";

type Props = {
  defaultValue: string;
  readOnly?: boolean;
  onChange: (markdown: string) => void;
  /** Cmd/Ctrl+S inside the editor. */
  onSave?: () => void;
};

export default function MdEditorVisual({ defaultValue, readOnly, onChange, onSave }: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const crepeRef = useRef<Crepe | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const readOnlyRef = useRef(Boolean(readOnly));
  readOnlyRef.current = Boolean(readOnly);
  // Crepe normalizes the parsed document on mount (list markers, spacing…) and
  // reports it via markdownUpdated before the user touches anything. Gate
  // change events on real interaction so an untouched doc never reads dirty.
  const interactedRef = useRef(false);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const crepe = new Crepe({
      root,
      defaultValue,
      features: {
        // Keep the surface lean: no AI affordances (the Cave has its own
        // agents), no LaTeX (katex weight), no Crepe top bar (the shell owns
        // the header chrome).
        [Crepe.Feature.AI]: false,
        [Crepe.Feature.Latex]: false,
        [Crepe.Feature.TopBar]: false,
      },
      featureConfigs: {
        // Code blocks use the Cave's CodeMirror theme (mood-c palette on the
        // always-dark --code-surface) instead of Crepe's bundled one-dark
        // colors, which don't adapt to app themes.
        [Crepe.Feature.CodeMirror]: { theme: caveCodeMirrorTheme },
      },
    });
    crepe.on((listener) => {
      listener.markdownUpdated((_ctx, markdown) => {
        if (!interactedRef.current) return;
        onChangeRef.current(markdown);
      });
    });
    let disposed = false;
    void crepe.create().then(() => {
      if (!disposed && readOnlyRef.current) crepe.setReadonly(true);
    });
    crepeRef.current = crepe;
    return () => {
      disposed = true;
      crepeRef.current = null;
      void crepe.destroy();
    };
    // Mount-once by design: document identity changes remount via `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    crepeRef.current?.setReadonly(Boolean(readOnly));
  }, [readOnly]);

  return (
    <div
      ref={rootRef}
      className="md-editor-visual"
      onPointerDownCapture={() => {
        interactedRef.current = true;
      }}
      onKeyDownCapture={() => {
        interactedRef.current = true;
      }}
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
          e.preventDefault();
          onSaveRef.current?.();
        }
      }}
    />
  );
}
