"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BrowseTemplatesModal } from "@/components/BrowseTemplatesModal";
import { ReindexButton } from "@/components/ReindexButton";
import {
  deleteTemplate,
  listTemplateCategories,
  listTemplates,
  updateTemplate,
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

type EditDraft = {
  name: string;
  category: string;
  jurisdiction: string;
  entity_scope: string;
  description: string;
};

export function TemplatesManager() {
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [categories, setCategories] = useState<TemplateCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filterCategory, setFilterCategory] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<EditDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [browseOpen, setBrowseOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rows, cats] = await Promise.all([listTemplates(), listTemplateCategories()]);
      setTemplates(rows);
      setCategories(cats);
      if (selectedId && !rows.some((r) => r.id === selectedId)) {
        setSelectedId(rows[0]?.id ?? null);
        setDraft(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load templates");
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const categoryOptions = useMemo(() => {
    const names = new Set([
      ...FALLBACK_CATEGORIES,
      ...categories.map((c) => c.name),
      ...templates.map((t) => t.category || t.agreement_type || "Other").filter(Boolean),
    ]);
    return Array.from(names);
  }, [categories, templates]);

  const filtered = useMemo(() => {
    let rows = templates;
    if (filterCategory !== "all") {
      rows = rows.filter(
        (t) => (t.category || t.agreement_type || "Other") === filterCategory,
      );
    }
    const q = query.trim().toLowerCase();
    if (q) {
      rows = rows.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.filename.toLowerCase().includes(q) ||
          (t.category || "").toLowerCase().includes(q) ||
          (t.agreement_type || "").toLowerCase().includes(q),
      );
    }
    return rows;
  }, [templates, filterCategory, query]);

  const selected = templates.find((t) => t.id === selectedId) || null;

  useEffect(() => {
    if (!selected) {
      setDraft(null);
      return;
    }
    setDraft({
      name: selected.name,
      category: selected.category || selected.agreement_type || "Other",
      jurisdiction: selected.jurisdiction || "",
      entity_scope: selected.entity_scope || "",
      description: selected.description || "",
    });
  }, [selected]);

  async function onSave() {
    if (!selected || !draft) return;
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const updated = await updateTemplate(selected.id, {
        name: draft.name,
        category: draft.category,
        jurisdiction: draft.jurisdiction || undefined,
        entity_scope: draft.entity_scope || undefined,
        description: draft.description || undefined,
      });
      setMessage(`Saved “${updated.name}”.`);
      await refresh();
      setSelectedId(updated.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function onDelete() {
    if (!selected) return;
    const ok = window.confirm(
      `Delete template “${selected.name}”? This removes the Word file from the catalog.`,
    );
    if (!ok) return;
    setDeleting(true);
    setMessage(null);
    setError(null);
    try {
      await deleteTemplate(selected.id);
      setMessage(`Deleted “${selected.name}”.`);
      setSelectedId(null);
      setDraft(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="tmpl-manage">
      <div className="tmpl-manage__header">
        <div>
          <h1 className="section-title">Templates</h1>
          <p className="section-lede">
            Maintain Capco Word templates — edit category and metadata, or remove ones you no longer need.
            Yellow fields stay indexed for Capco Wayne.
          </p>
        </div>
        <div className="tmpl-manage__actions">
          <button type="button" className="btn btn--primary" onClick={() => setBrowseOpen(true)}>
            + New / Browse
          </button>
          <ReindexButton />
        </div>
      </div>

      {(error || message) && (
        <p className={error ? "tmpl-manage__error" : "muted"} style={{ marginBottom: "0.75rem" }}>
          {error || message}
        </p>
      )}

      <div className="tmpl-manage__layout">
        <section className="panel tmpl-manage__list">
          <div className="panel__head tmpl-manage__list-head">
            <input
              className="tmpl-manage__search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search templates…"
            />
            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              aria-label="Filter by category"
            >
              <option value="all">All categories</option>
              {categoryOptions.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="panel__body" style={{ padding: 0 }}>
            {loading && <p className="muted" style={{ padding: "1rem" }}>Loading…</p>}
            <ul className="tmpl-manage__items">
              {filtered.map((template) => (
                <li key={template.id}>
                  <button
                    type="button"
                    className="tmpl-manage__item"
                    data-active={selectedId === template.id ? "true" : "false"}
                    onClick={() => setSelectedId(template.id)}
                  >
                    <strong>{template.name}</strong>
                    <span className="tmpl-manage__meta">
                      <span className="badge">{template.category || template.agreement_type || "Other"}</span>
                      <span className="badge badge--field">
                        <span className="field-swatch" />
                        {template.field_count}
                      </span>
                    </span>
                    <span className="muted" style={{ fontSize: "0.78rem" }}>
                      {template.filename}
                    </span>
                  </button>
                </li>
              ))}
              {!loading && filtered.length === 0 && (
                <li className="muted" style={{ padding: "1rem" }}>
                  No templates match. Upload one via <strong>+ New / Browse</strong>.
                </li>
              )}
            </ul>
          </div>
        </section>

        <section className="panel tmpl-manage__editor">
          <div className="panel__head">
            <h2 className="section-title" style={{ fontSize: "1.2rem", margin: 0 }}>
              {selected ? "Edit template" : "Select a template"}
            </h2>
          </div>
          <div className="panel__body">
            {!selected || !draft ? (
              <p className="muted">Choose a template on the left to rename, recategorize, or delete it.</p>
            ) : (
              <>
                <div className="tmpl-manage__form">
                  <label className="field">
                    <span>Name</span>
                    <input
                      value={draft.name}
                      onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    />
                  </label>
                  <label className="field">
                    <span>Category</span>
                    <select
                      value={draft.category}
                      onChange={(e) => setDraft({ ...draft, category: e.target.value })}
                    >
                      {categoryOptions.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Jurisdiction</span>
                    <input
                      value={draft.jurisdiction}
                      onChange={(e) => setDraft({ ...draft, jurisdiction: e.target.value })}
                      placeholder="e.g. Hong Kong"
                    />
                  </label>
                  <label className="field">
                    <span>Entity scope</span>
                    <input
                      value={draft.entity_scope}
                      onChange={(e) => setDraft({ ...draft, entity_scope: e.target.value })}
                      placeholder="e.g. Capco group"
                    />
                  </label>
                  <label className="field">
                    <span>Description</span>
                    <textarea
                      rows={3}
                      value={draft.description}
                      onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                    />
                  </label>
                </div>

                <div className="tmpl-manage__footer">
                  <button
                    type="button"
                    className="btn btn--primary"
                    disabled={saving || !draft.name.trim()}
                    onClick={() => void onSave()}
                  >
                    {saving ? "Saving…" : "Save changes"}
                  </button>
                  <Link
                    className="btn"
                    href={`/workspace?template=${encodeURIComponent(selected.id)}&mode=draft`}
                  >
                    Open in editor
                  </Link>
                  <Link className="btn" href={`/templates/${encodeURIComponent(selected.id)}`}>
                    View fields
                  </Link>
                  <button
                    type="button"
                    className="btn tmpl-manage__danger"
                    disabled={deleting}
                    onClick={() => void onDelete()}
                  >
                    {deleting ? "Deleting…" : "Delete"}
                  </button>
                </div>
              </>
            )}
          </div>
        </section>
      </div>

      <BrowseTemplatesModal
        open={browseOpen}
        onClose={() => {
          setBrowseOpen(false);
          void refresh();
        }}
      />
    </div>
  );
}
