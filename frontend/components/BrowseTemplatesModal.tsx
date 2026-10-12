"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  listTemplateCategories,
  listTemplates,
  uploadTemplate,
  type TemplateCategory,
  type TemplateSummary,
} from "@/lib/api";

const FALLBACK_CATEGORIES = [
  "NDA",
  "MSA",
  "SOW",
  "Employment",
  "Vendor Agreement",
  "License Agreement",
  "DPA",
  "Consultancy Agreement",
  "Other",
];

function templateCategory(template: TemplateSummary): string {
  return (template.category || template.agreement_type || "Other").trim() || "Other";
}

type Props = {
  open: boolean;
  onClose: () => void;
};

export function BrowseTemplatesModal({ open, onClose }: Props) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [categories, setCategories] = useState<TemplateCategory[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [section, setSection] = useState<"org" | "mine" | "categories">("categories");
  const [category, setCategory] = useState("NDA");
  const [newOpen, setNewOpen] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [uploadCategory, setUploadCategory] = useState("NDA");
  const [customCategory, setCustomCategory] = useState("");
  const [uploadName, setUploadName] = useState("");
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    void Promise.all([listTemplates(), listTemplateCategories()])
      .then(([rows, cats]) => {
        setTemplates(rows);
        setCategories(cats.length ? cats : FALLBACK_CATEGORIES.map((name) => ({ id: name, name, count: 0 })));
        if (cats.some((c) => c.id === "NDA")) setCategory("NDA");
        else if (cats[0]) setCategory(cats[0].id);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load templates"))
      .finally(() => setLoading(false));
  }, [open]);

  const categoryOptions = useMemo(() => {
    if (categories.length) return categories;
    return FALLBACK_CATEGORIES.map((name) => ({ id: name, name, count: 0 }));
  }, [categories]);

  const filtered = useMemo(() => {
    let rows = templates;
    if (section === "org") {
      rows = rows.filter((t) => /\/corporate\//i.test(t.source_path));
    } else if (section === "mine") {
      rows = rows.filter((t) => !/\/corporate\//i.test(t.source_path));
    } else {
      rows = rows.filter((t) => templateCategory(t) === category);
    }
    const q = query.trim().toLowerCase();
    if (q) {
      rows = rows.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          templateCategory(t).toLowerCase().includes(q) ||
          (t.agreement_type || "").toLowerCase().includes(q) ||
          t.filename.toLowerCase().includes(q),
      );
    }
    return rows;
  }, [templates, section, category, query]);

  function openTemplate(id: string) {
    onClose();
    router.push(`/workspace?template=${encodeURIComponent(id)}&mode=draft`);
  }

  function resolvedUploadCategory() {
    if (uploadCategory === "__custom__") {
      return customCategory.trim() || "Other";
    }
    return uploadCategory;
  }

  async function submitUpload() {
    if (!pendingFile) return;
    const cat = resolvedUploadCategory();
    if (!cat) {
      setError("Choose or enter a category (e.g. NDA, MSA).");
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const detail = await uploadTemplate(pendingFile, {
        category: cat,
        name: uploadName.trim() || undefined,
      });
      setNewOpen(false);
      setPendingFile(null);
      setUploadName("");
      setCustomCategory("");
      onClose();
      router.push(`/workspace?template=${encodeURIComponent(detail.id)}&mode=draft`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  if (!open) return null;

  return (
    <div className="tmpl-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="tmpl-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Browse Templates"
        onClick={(e) => e.stopPropagation()}
      >
        {!newOpen ? (
          <>
            <aside className="tmpl-modal__nav">
              <button type="button" className="btn btn--primary tmpl-modal__new" onClick={() => setNewOpen(true)}>
                + New Template
              </button>
              <a className="tmpl-nav-item" href="/templates" style={{ textDecoration: "none" }}>
                Manage templates →
              </a>
              <button
                type="button"
                className="tmpl-nav-item"
                data-active={section === "org" ? "true" : "false"}
                onClick={() => setSection("org")}
              >
                Org Templates
              </button>
              <button
                type="button"
                className="tmpl-nav-item"
                data-active={section === "mine" ? "true" : "false"}
                onClick={() => setSection("mine")}
              >
                My Templates
              </button>
              <button
                type="button"
                className="tmpl-nav-item"
                data-active={section === "categories" ? "true" : "false"}
                onClick={() => setSection("categories")}
              >
                By category
              </button>
              {section === "categories" && (
                <div className="tmpl-nav-sub">
                  {categoryOptions.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className="tmpl-nav-sub__item"
                      data-active={category === item.id ? "true" : "false"}
                      onClick={() => setCategory(item.id)}
                    >
                      <span>{item.name}</span>
                      <span className="tmpl-nav-count">{item.count}</span>
                    </button>
                  ))}
                </div>
              )}
            </aside>

            <div className="tmpl-modal__main">
              <div className="tmpl-modal__top">
                <div className="tmpl-search">
                  <span aria-hidden>⌕</span>
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search Templates"
                  />
                </div>
                <button type="button" className="tmpl-close" onClick={onClose} aria-label="Close">
                  ×
                </button>
              </div>

              {section === "categories" && (
                <p className="tmpl-modal__filter-label">
                  Category: <strong>{category}</strong>
                </p>
              )}

              {loading && <p className="muted">Loading templates…</p>}
              {error && <p className="muted">{error}</p>}

              <div className="tmpl-grid">
                {filtered.map((template) => (
                  <button
                    key={template.id}
                    type="button"
                    className="tmpl-card"
                    onClick={() => openTemplate(template.id)}
                  >
                    <div className="tmpl-card__preview">
                      <div className="tmpl-card__lines">
                        <strong>{template.name.slice(0, 28)}</strong>
                        <span className="tmpl-card__cat">{templateCategory(template)}</span>
                        <span>{template.field_count} yellow fields</span>
                        <span className="tmpl-card__ghost">[Effective Date]</span>
                        <span className="tmpl-card__ghost">[Party Name]</span>
                      </div>
                    </div>
                    <span className="tmpl-card__label">{template.name}</span>
                  </button>
                ))}
                {!loading && !filtered.length && (
                  <p className="muted" style={{ gridColumn: "1 / -1" }}>
                    No templates in <strong>{section === "categories" ? category : "this section"}</strong>.
                    Use <strong>+ New Template</strong> and assign a category (NDA, MSA, …).
                  </p>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="tmpl-new">
            <div className="tmpl-modal__top">
              <h2>Steps for New Template</h2>
              <button type="button" className="tmpl-close" onClick={() => setNewOpen(false)} aria-label="Close">
                ×
              </button>
            </div>
            <p className="tmpl-new__lede">Follow the instructions to create a new template</p>
            <ul className="tmpl-new__steps">
              <li>Draft the document in editor.</li>
              <li>Save the document</li>
              <li>
                Go to <span className="badge">ⓘ</span> button in the right toolbar.
              </li>
              <li>Save as template</li>
            </ul>
            <div className="tmpl-new__or">OR</div>
            <p className="tmpl-new__lede">
              Upload a .docx and assign a category (NDA, MSA, SOW, …)
            </p>

            <div className="tmpl-new__fields">
              <label className="field">
                <span>Category</span>
                <select
                  value={uploadCategory}
                  onChange={(e) => setUploadCategory(e.target.value)}
                >
                  {FALLBACK_CATEGORIES.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                  <option value="__custom__">Custom category…</option>
                </select>
              </label>
              {uploadCategory === "__custom__" && (
                <label className="field">
                  <span>Custom category name</span>
                  <input
                    value={customCategory}
                    onChange={(e) => setCustomCategory(e.target.value)}
                    placeholder="e.g. Partnership Agreement"
                  />
                </label>
              )}
              <label className="field">
                <span>Display name (optional)</span>
                <input
                  value={uploadName}
                  onChange={(e) => setUploadName(e.target.value)}
                  placeholder="Mutual NDA — Capco / Client"
                />
              </label>
            </div>

            <div
              className="tmpl-drop"
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const file = e.dataTransfer.files?.[0];
                if (file) setPendingFile(file);
              }}
            >
              {pendingFile ? (
                <div className="tmpl-drop__file">
                  <div className="tmpl-drop__thumb">DOC</div>
                  <div>
                    <strong>{pendingFile.name}</strong>
                    <div className="muted">{(pendingFile.size / 1024).toFixed(2)} KB</div>
                  </div>
                </div>
              ) : (
                <>
                  <div className="tmpl-drop__icon">☁︎</div>
                  <p>Drag & drop here, or click to upload</p>
                  <button type="button" className="btn btn--primary">
                    Browse
                  </button>
                  <p className="muted">Max. size (5.00 MB)</p>
                </>
              )}
              <input
                ref={fileRef}
                type="file"
                accept=".docx,.doc"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) setPendingFile(file);
                }}
              />
            </div>
            {error && <p className="muted">{error}</p>}
            <button
              type="button"
              className="btn btn--primary tmpl-new__upload"
              disabled={!pendingFile || uploading}
              onClick={() => void submitUpload()}
            >
              {uploading
                ? "Analyzing fields with Capco Wayne…"
                : `Upload as ${resolvedUploadCategory()}`}
            </button>
            <p className="muted" style={{ fontSize: "0.8rem", marginTop: "0.75rem" }}>
              Capco Wayne scans for blanks (____, $____, dates, brackets) and yellow-highlights
              every field you need to fill.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
