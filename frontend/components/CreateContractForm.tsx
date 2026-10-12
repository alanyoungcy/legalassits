"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createContract,
  getApiBase,
  type TemplateDetail,
  type TemplateSummary,
} from "@/lib/api";

export function CreateContractForm({
  templates,
  initialTemplateId,
}: {
  templates: TemplateSummary[];
  initialTemplateId?: string;
}) {
  const router = useRouter();
  const [templateId, setTemplateId] = useState(
    initialTemplateId || templates[0]?.id || "",
  );
  const [detail, setDetail] = useState<TemplateDetail | null>(null);
  const [title, setTitle] = useState("");
  const [legalEntity, setLegalEntity] = useState("Capco");
  const [governingLaw, setGoverningLaw] = useState("Hong Kong");
  const [counterparty, setCounterparty] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const selectedSummary = useMemo(
    () => templates.find((item) => item.id === templateId) || null,
    [templates, templateId],
  );

  useEffect(() => {
    if (!templateId) return;
    let cancelled = false;

    async function loadDetail() {
      setError(null);
      try {
        const response = await fetch(`${getApiBase()}/api/v1/templates/${templateId}`, {
          cache: "no-store",
        });
        if (!response.ok) throw new Error("Failed to load template fields");
        const data = (await response.json()) as TemplateDetail;
        if (cancelled) return;
        setDetail(data);
        setTitle((current) => current || `${data.name} draft`);
        const next: Record<string, string> = {};
        for (const field of data.fields) next[field.key] = "";
        setValues(next);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load template");
        }
      }
    }

    void loadDetail();
    return () => {
      cancelled = true;
    };
  }, [templateId]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!templateId) return;
    setBusy(true);
    setError(null);
    try {
      const contract = await createContract({
        template_id: templateId,
        title,
        field_values: values,
        legal_entity: legalEntity,
        governing_law: governingLaw,
        counterparty: counterparty || undefined,
      });
      router.push(`/contracts/${contract.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="split">
      <section className="panel">
        <div className="panel__head">
          <h2 className="section-title" style={{ fontSize: "1.3rem", margin: 0 }}>
            Request details
          </h2>
        </div>
        <div className="panel__body form-grid">
          <div className="field field--full">
            <label htmlFor="template">Corporate template</label>
            <select
              id="template"
              value={templateId}
              onChange={(event) => setTemplateId(event.target.value)}
              required
            >
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                  {template.agreement_type ? ` · ${template.agreement_type}` : ""}
                </option>
              ))}
            </select>
            {selectedSummary?.description && (
              <span className="field__hint">{selectedSummary.description}</span>
            )}
          </div>
          <div className="field field--full">
            <label htmlFor="title">Draft title</label>
            <input
              id="title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="entity">Capco legal entity</label>
            <input
              id="entity"
              value={legalEntity}
              onChange={(event) => setLegalEntity(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="law">Governing law</label>
            <input
              id="law"
              value={governingLaw}
              onChange={(event) => setGoverningLaw(event.target.value)}
            />
          </div>
          <div className="field field--full">
            <label htmlFor="counterparty">Counterparty</label>
            <input
              id="counterparty"
              value={counterparty}
              onChange={(event) => setCounterparty(event.target.value)}
            />
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel__head">
          <div>
            <h2 className="section-title" style={{ fontSize: "1.3rem", margin: 0 }}>
              Yellow field values
            </h2>
            <p className="muted" style={{ margin: "0.35rem 0 0" }}>
              Values replace highlighted placeholders and clear the yellow mark on export.
            </p>
          </div>
        </div>
        <div className="panel__body form-grid">
          {(detail?.fields || []).map((field) => (
            <div className="field field--full" key={field.key}>
              <label htmlFor={field.key}>
                {field.label}{" "}
                {field.required && <span className="badge badge--field">required</span>}
              </label>
              <input
                id={field.key}
                value={values[field.key] || ""}
                onChange={(event) =>
                  setValues((current) => ({ ...current, [field.key]: event.target.value }))
                }
                placeholder={field.placeholder}
              />
              {field.sample_context && (
                <span className="field__hint">Context: {field.sample_context}</span>
              )}
            </div>
          ))}
          {!detail && <p className="muted">Select a template to load yellow fields.</p>}
          {error && <p className="muted field--full">{error}</p>}
          <div className="field--full" style={{ display: "flex", gap: "0.75rem" }}>
            <button className="btn btn--solid" type="submit" disabled={busy || !templateId}>
              {busy ? "Generating…" : "Generate Word draft"}
            </button>
          </div>
        </div>
      </section>
    </form>
  );
}
