"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { DocxEditor, type DocxEditorRef } from "@docx-editor.dev/react";
import type { Editor } from "@docx-editor.dev/core/contracts/editor";
import { packagedFonts } from "@docx-editor.dev/fonts";
import "@docx-editor.dev/core/styles/editor.css";
import { placeholderQueries } from "@/lib/docReplace";

export type FieldReplacement = {
  from: string;
  to: string;
};

export type DocxCanvasHandle = {
  /** Returns how many text matches were actually replaced in the live editor. */
  applyReplacements: (items: FieldReplacement[]) => number;
  ready: () => boolean;
  /** True when the editor facade is available for find/replace. */
  getEditor: () => Editor | null;
  /** Swap the open document for filled bytes (server-side sync fallback). */
  loadBytes: (bytes: Uint8Array) => void;
  /** Serialize the live editor document to .docx bytes. */
  saveBytes: () => Promise<Uint8Array | null>;
};

type DocxCanvasProps = {
  docxUrl?: string | null;
  title: string;
  onTitleChange: (title: string) => void;
  author?: string;
  onEditorReady?: () => void;
  /** Prefer this over ref when the parent loads DocxCanvas via next/dynamic. */
  onHandle?: (handle: DocxCanvasHandle | null) => void;
};

function replaceOneQuery(editor: Editor, query: string, text: string): number {
  const matches = editor.findMatches(query, { matchCase: true });
  const loose = matches.length
    ? matches
    : editor.findMatches(query, { matchCase: false });
  if (!loose.length) return 0;
  const matchCase = matches.length > 0;

  const result = editor.exec({
    type: "replaceAllMatches",
    query,
    text,
    matchCase,
  });
  if (result && "ok" in result && result.ok === false) {
    for (let i = loose.length - 1; i >= 0; i -= 1) {
      editor.exec({ type: "replaceMatch", match: loose[i], text });
    }
  }

  // Only count as success if the query is actually gone (EigenPal can no-op)
  const still = editor.findMatches(query, { matchCase: false });
  if (still.length >= loose.length) {
    for (let i = loose.length - 1; i >= 0; i -= 1) {
      editor.exec({ type: "replaceMatch", match: loose[i], text });
    }
  }
  const remaining = editor.findMatches(query, { matchCase: false });
  const removed = loose.length - remaining.length;
  return removed > 0 ? removed : 0;
}

/**
 * EigenPal docx-editor (https://github.com/eigenpal/docx-editor)
 * Must run client-side only — wrap with next/dynamic ssr:false.
 */
export const DocxCanvas = forwardRef<DocxCanvasHandle, DocxCanvasProps>(
  function DocxCanvas(
    { docxUrl, title, onTitleChange, author = "Alan Young", onEditorReady, onHandle },
    ref,
  ) {
    const editorRef = useRef<DocxEditorRef | null>(null);
    const [bytes, setBytes] = useState<Uint8Array | "blank" | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [mounted, setMounted] = useState(false);
    /** Bump to force DocxEditor remount when server-filled bytes arrive. */
    const [docRevision, setDocRevision] = useState(0);
    const fonts = useState(() => packagedFonts())[0];

    useEffect(() => {
      let cancelled = false;

      async function load() {
        setLoading(true);
        setError(null);
        setMounted(false);
        setDocRevision(0);
        if (!docxUrl) {
          if (!cancelled) {
            setBytes("blank");
            setLoading(false);
          }
          return;
        }
        try {
          const response = await fetch(docxUrl, { cache: "no-store" });
          if (!response.ok) {
            throw new Error(`Failed to load document (${response.status})`);
          }
          const raw = await response.arrayBuffer();
          // Detached copy — some editors mis-handle views over large shared buffers
          const buffer = new Uint8Array(raw.slice(0));
          if (buffer.byteLength < 128) {
            throw new Error("Document file is empty or invalid");
          }
          if (!cancelled) setBytes(buffer);
        } catch (err) {
          if (!cancelled) {
            setError(err instanceof Error ? err.message : "Failed to load .docx");
            setBytes("blank");
          }
        } finally {
          if (!cancelled) setLoading(false);
        }
      }

      void load();
      return () => {
        cancelled = true;
      };
    }, [docxUrl]);

    const applyReplacements = useCallback((items: FieldReplacement[]) => {
      const editor = editorRef.current?.getEditor?.() ?? null;
      if (!editor || !items.length) return 0;

      let replaced = 0;
      for (const item of items) {
        const to = item.to;
        if (to === undefined) continue;
        const queries = placeholderQueries(item.from);
        for (const query of queries) {
          try {
            const n = replaceOneQuery(editor, query, to);
            if (n > 0) {
              replaced += n;
              break;
            }
          } catch {
            // try next query variant
          }
        }
      }
      return replaced;
    }, []);

    const loadBytes = useCallback((next: Uint8Array) => {
      // Remount DocxEditor with new bytes — load() alone often does not refresh the page view
      setMounted(false);
      setBytes(next);
      setDocRevision((n) => n + 1);
      // Also try in-place load for editors that support it without remount
      queueMicrotask(() => {
        editorRef.current?.load(next);
      });
    }, []);

    const saveBytes = useCallback(async () => {
      const buffer = await editorRef.current?.save?.();
      if (!buffer) return null;
      return buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    }, []);

    const getHandle = useCallback(
      (): DocxCanvasHandle => ({
        applyReplacements,
        ready: () => Boolean(editorRef.current?.getEditor?.()),
        getEditor: () => editorRef.current?.getEditor?.() ?? null,
        loadBytes,
        saveBytes,
      }),
      [applyReplacements, loadBytes, saveBytes],
    );

    useImperativeHandle(ref, getHandle, [getHandle]);

    useEffect(() => {
      onHandle?.(getHandle());
      return () => onHandle?.(null);
    }, [getHandle, onHandle, mounted]);

    if (loading) {
      return (
        <div className="docx-canvas docx-canvas--status">
          <p className="muted">Loading Word document…</p>
        </div>
      );
    }

    return (
      <div className="docx-canvas">
        {error && (
          <div className="docx-canvas__banner">
            {error} — opened a blank document instead.
          </div>
        )}
        <div className="docx-canvas__editor">
          {bytes && (
            <DocxEditor
              key={`${docxUrl || "blank"}::${docRevision}`}
              ref={editorRef}
              document={bytes}
              fonts={fonts}
              mode="edit"
              author={author}
              title={title}
              onTitleChange={onTitleChange}
              onReady={() => {
                setMounted(true);
                onEditorReady?.();
                onHandle?.(getHandle());
              }}
            />
          )}
          {!mounted && !error && (
            <p className="muted" style={{ padding: "0.5rem 1rem", margin: 0 }}>
              Preparing editor…
            </p>
          )}
        </div>
      </div>
    );
  },
);
