"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BrowseTemplatesModal } from "@/components/BrowseTemplatesModal";
import { CapcoWaynePanel } from "@/components/CapcoWaynePanel";
import type { DocxCanvasHandle } from "@/components/DocxCanvas";
import {
  aiStatus,
  bytesToBase64,
  downloadContractUrl,
  fillDocumentFields,
  getApiBase,
  getContract,
  getDocument,
  getWorkspaceFromTemplate,
  saveWorkspaceContract,
} from "@/lib/api";

const DocxCanvas = dynamic(
  () => import("@/components/DocxCanvas").then((mod) => mod.DocxCanvas),
  {
    ssr: false,
    loading: () => (
      <div className="docx-canvas docx-canvas--status">
        <p className="muted">Starting Word editor…</p>
      </div>
    ),
  },
);

type EditorField = {
  key: string;
  label: string;
  placeholder: string;
  value?: string;
};

type WorkspacePayload = {
  title: string;
  plain_text?: string;
  fields?: EditorField[];
  template_id?: string;
  agreement_type?: string | null;
  source?: string;
  id?: string;
  docx_url?: string;
};

function toAbsoluteDocxUrl(pathOrUrl?: string | null) {
  if (!pathOrUrl) return null;
  if (pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://")) {
    return pathOrUrl;
  }
  return `${getApiBase()}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`;
}

export function WorkspaceApp({
  templateId,
  documentId,
  contractId: initialContractId,
  mode,
  initialPrompt,
  autoStartAssess = false,
}: {
  templateId?: string;
  documentId?: string;
  contractId?: string;
  mode: string;
  initialPrompt?: string;
  autoStartAssess?: boolean;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const docxHandleRef = useRef<DocxCanvasHandle | null>(null);
  const appliedRef = useRef<Record<string, string>>({});
  const dirtyRef = useRef(true);
  const copilotName = process.env.NEXT_PUBLIC_COPILOT_NAME || "Capco Wayne";
  const [title, setTitle] = useState("Untitled Document");
  const [payload, setPayload] = useState<WorkspacePayload | null>(null);
  const [docxUrl, setDocxUrl] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [editorReady, setEditorReady] = useState(false);
  const [exitOpen, setExitOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [contractId, setContractId] = useState<string | undefined>(initialContractId);
  const [wayneWidth, setWayneWidth] = useState(420);
  const [resizingWayne, setResizingWayne] = useState(false);
  const wayneWidthRef = useRef(420);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem("capco.wayneWidth");
      if (stored) {
        const n = Number(stored);
        if (Number.isFinite(n) && n >= 300 && n <= 900) {
          setWayneWidth(n);
          wayneWidthRef.current = n;
        }
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!resizingWayne) return;
    const onMove = (event: MouseEvent) => {
      const next = Math.min(900, Math.max(300, window.innerWidth - event.clientX));
      wayneWidthRef.current = next;
      setWayneWidth(next);
    };
    const onUp = () => {
      setResizingWayne(false);
      try {
        window.localStorage.setItem("capco.wayneWidth", String(wayneWidthRef.current));
      } catch {
        /* ignore */
      }
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [resizingWayne]);

  useEffect(() => {
    void aiStatus()
      .then((status) => setConfigured(status.configured))
      .catch(() => setConfigured(false));
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setBusy(true);
      setError(null);
      appliedRef.current = {};
      setEditorReady(false);
      try {
        let data: WorkspacePayload;
        if (initialContractId) {
          const detail = await getContract(initialContractId);
          data = {
            title: detail.title,
            template_id: detail.template_id,
            fields: (detail.fields || []).map((f) => ({
              key: f.key,
              label: f.label,
              placeholder: f.placeholder,
              value: detail.field_values?.[f.key] || "",
            })),
            agreement_type: null,
            plain_text: "",
          };
          if (!cancelled) {
            setContractId(detail.id);
            setDocxUrl(toAbsoluteDocxUrl(downloadContractUrl(detail.id)));
            setValues(detail.field_values || {});
            appliedRef.current = { ...(detail.field_values || {}) };
            dirtyRef.current = false;
          }
        } else if (documentId) {
          data = (await getDocument(documentId)) as WorkspacePayload;
          if (!cancelled) {
            setDocxUrl(toAbsoluteDocxUrl(data.docx_url || `/api/v1/documents/${documentId}/docx`));
          }
        } else if (templateId) {
          data = (await getWorkspaceFromTemplate(templateId)) as WorkspacePayload;
          if (!cancelled) {
            setDocxUrl(
              toAbsoluteDocxUrl(
                data.docx_url || `/api/v1/documents/workspace/from-template/${templateId}/docx`,
              ),
            );
          }
        } else {
          data = { title: "Untitled Document", fields: [], plain_text: "" };
          if (!cancelled) setDocxUrl(null);
        }
        if (cancelled) return;
        setPayload(data);
        setTitle(data.title || "Untitled Document");
        if (!initialContractId) {
          const next: Record<string, string> = {};
          for (const field of data.fields || []) next[field.key] = field.value || "";
          setValues(next);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load workspace");
      } finally {
        if (!cancelled) setBusy(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [templateId, documentId, initialContractId]);

  const fields = useMemo(() => payload?.fields || [], [payload]);

  const waitForCanvas = useCallback(async (tries = 20) => {
    for (let i = 0; i < tries; i += 1) {
      const canvas = docxHandleRef.current;
      if (canvas?.loadBytes) return canvas;
      await new Promise((r) => setTimeout(r, 100));
    }
    return docxHandleRef.current;
  }, []);

  const applyFieldsToDocument = useCallback(
    async (updates: Record<string, string>) => {
      const pending = Object.entries(updates).filter(([, v]) => (v || "").trim());
      if (!pending.length) return 0;

      const canvas = (await waitForCanvas()) || docxHandleRef.current;
      dirtyRef.current = true;

      if ((templateId || documentId) && canvas?.loadBytes) {
        try {
          const mergedValues = { ...appliedRef.current };
          for (const [key, raw] of pending) mergedValues[key] = raw.trim();
          const bytes = await fillDocumentFields({
            values: mergedValues,
            template_id: templateId,
            document_id: documentId,
            clear_highlight: false,
          });
          const live = (await waitForCanvas()) || canvas;
          live.loadBytes(bytes);
          for (const [key, raw] of Object.entries(mergedValues)) {
            if (raw?.trim()) appliedRef.current[key] = raw.trim();
          }
          return pending.length;
        } catch (err) {
          console.warn("[Capco Wayne] server fill failed, trying in-editor replace", err);
        }
      }

      let applied = 0;
      if (canvas?.ready()) {
        for (const [key, raw] of pending) {
          const value = raw.trim();
          const field = fields.find((f) => f.key === key);
          if (!field) continue;
          const previous = appliedRef.current[key];
          if (previous === value) {
            applied += 1;
            continue;
          }
          const fromCandidates = [
            previous,
            field.placeholder,
            `[${field.label}]`,
            field.label,
          ].filter((v): v is string => Boolean(v && v.trim() && v !== value));

          let wrote = 0;
          for (const from of fromCandidates) {
            wrote = canvas.applyReplacements([{ from, to: value }]);
            if (wrote > 0) break;
          }
          if (wrote > 0) {
            appliedRef.current[key] = value;
            applied += 1;
          }
        }
      }
      return applied;
    },
    [fields, templateId, documentId, waitForCanvas],
  );

  const persistDraft = useCallback(async () => {
    const canvas = (await waitForCanvas()) || docxHandleRef.current;
    let docxBase64: string | undefined;
    try {
      const bytes = await canvas?.saveBytes?.();
      if (bytes?.length) docxBase64 = bytesToBase64(bytes);
    } catch (err) {
      console.warn("[workspace] editor save failed, falling back to template fill", err);
    }

    const resolvedTemplateId =
      templateId ||
      (payload?.template_id && !payload.template_id.startsWith("doc:") && payload.template_id !== "workspace"
        ? payload.template_id
        : undefined);

    const saved = await saveWorkspaceContract({
      title: title.trim() || "Untitled Document",
      field_values: values,
      template_id: resolvedTemplateId,
      document_id: documentId,
      agreement_type: payload?.agreement_type || undefined,
      docx_base64: docxBase64,
      contract_id: contractId,
    });
    setContractId(saved.id);
    dirtyRef.current = false;
    return saved;
  }, [
    waitForCanvas,
    templateId,
    payload?.template_id,
    payload?.agreement_type,
    title,
    values,
    documentId,
    contractId,
  ]);

  async function onSaveOnly() {
    setSaving(true);
    setError(null);
    try {
      const saved = await persistDraft();
      setError(null);
      // brief confirmation via title flash not needed — show muted line
      setPayload((p) => (p ? { ...p, title: saved.title } : p));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function onSaveAndExit() {
    setSaving(true);
    setError(null);
    try {
      await persistDraft();
      setExitOpen(false);
      router.push("/inbox");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
      setSaving(false);
    }
  }

  function onDiscardAndExit() {
    dirtyRef.current = false;
    setExitOpen(false);
    router.push("/inbox");
  }

  function requestExit() {
    if (!dirtyRef.current && contractId) {
      router.push("/inbox");
      return;
    }
    setExitOpen(true);
  }

  async function onUpload(file: File) {
    setBusy(true);
    setError(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const response = await fetch(`${getApiBase()}/api/v1/documents/upload?mode=review`, {
        method: "POST",
        body,
      });
      if (!response.ok) throw new Error(await response.text());
      const doc = await response.json();
      window.location.href = `/workspace?document=${encodeURIComponent(doc.id)}&mode=review`;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
      setBusy(false);
    }
  }

  return (
    <div className="workspace workspace--editor">
      <section className="editor-pane">
        <div className="editor-top">
          <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
            <button type="button" className="btn" onClick={requestExit} title="Back to Inbox">
              ←
            </button>
            <input
              className="editor-top__title"
              value={title}
              onChange={(event) => {
                dirtyRef.current = true;
                setTitle(event.target.value);
              }}
            />
          </div>
          <div style={{ display: "flex", gap: "0.55rem", alignItems: "center" }}>
            <button
              type="button"
              className="btn btn--save"
              disabled={busy || saving}
              onClick={() => void onSaveOnly()}
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <div className="user-chip">
              <span className="user-chip__avatar">AY</span>
              <span>Alan Young</span>
            </div>
          </div>
        </div>

        <div className="editor-tools">
          <button type="button" className="btn" onClick={() => setTemplatesOpen(true)}>
            Templates
          </button>
          <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
            Upload
          </button>
          <button type="button" className="btn" onClick={() => router.push("/inbox")}>
            Inbox
          </button>
          <span className="muted" style={{ marginLeft: "auto", fontSize: "0.85rem" }}>
            EigenPal docx-editor · Capco Wayne
            {editorReady ? " · live edits on" : ""}
            {contractId ? " · saved" : ""}
          </span>
          <input
            ref={fileRef}
            type="file"
            accept=".docx"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void onUpload(file);
            }}
          />
        </div>

        {error && (
          <p className="muted" style={{ padding: "0.5rem 1rem", margin: 0, color: "#b42318" }}>
            {error}
          </p>
        )}

        <div className="canvas-wrap canvas-wrap--docx">
          <DocxCanvas
            docxUrl={docxUrl}
            title={title}
            onTitleChange={(next) => {
              dirtyRef.current = true;
              setTitle(next);
            }}
            author="Alan Young"
            onHandle={(handle) => {
              docxHandleRef.current = handle;
            }}
            onEditorReady={() => setEditorReady(true)}
          />
        </div>
      </section>

      <div
        className="wayne-shell"
        data-resizing={resizingWayne ? "true" : "false"}
        style={{ width: wayneWidth }}
      >
        <button
          type="button"
          className="wayne-resize-handle"
          aria-label="Resize Capco Wayne panel"
          title="Drag to resize"
          onMouseDown={(event) => {
            event.preventDefault();
            setResizingWayne(true);
          }}
        />
        <CapcoWaynePanel
          copilotName={copilotName}
          title={title}
          agreementType={payload?.agreement_type}
          plainText={payload?.plain_text}
          fields={fields}
          values={values}
          onValuesChange={(next) => {
            dirtyRef.current = true;
            setValues(next);
          }}
          onApplyFields={applyFieldsToDocument}
          configured={configured}
          initialMode={
            mode === "create"
              ? "improve"
              : mode === "review" || mode === "assess"
                ? "assess"
                : "complete"
          }
          initialPrompt={initialPrompt}
          freshStart={mode === "create" && !templateId && !documentId && !initialContractId}
          autoStartAssess={autoStartAssess && Boolean(documentId || initialContractId || templateId)}
          onBrowseTemplates={() => setTemplatesOpen(true)}
          onUploadDocument={() => fileRef.current?.click()}
        />
      </div>

      <BrowseTemplatesModal open={templatesOpen} onClose={() => setTemplatesOpen(false)} />

      {exitOpen && (
        <div
          className="exit-modal-backdrop"
          role="presentation"
          onClick={() => !saving && setExitOpen(false)}
        >
          <div
            className="exit-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="exit-modal-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="exit-modal-title">Leave workspace?</h2>
            <p>
              Save this contract to your <strong>Inbox</strong> before leaving, or discard changes and
              exit.
            </p>
            <div className="exit-modal__actions">
              <button
                type="button"
                className="btn"
                disabled={saving}
                onClick={() => setExitOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn"
                disabled={saving}
                onClick={onDiscardAndExit}
              >
                Discard &amp; exit
              </button>
              <button
                type="button"
                className="btn btn--solid"
                disabled={saving}
                onClick={() => void onSaveAndExit()}
              >
                {saving ? "Saving…" : "Save & exit"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
