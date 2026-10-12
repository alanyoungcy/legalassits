import Link from "next/link";
import { notFound } from "next/navigation";
import { getTemplate } from "@/lib/api";

export default async function TemplateDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let template: Awaited<ReturnType<typeof getTemplate>>;
  try {
    template = await getTemplate(id);
  } catch {
    notFound();
  }

  return (
    <div className="page">
      <p className="muted" style={{ marginTop: 0 }}>
        <Link href="/templates">Templates</Link> / {template.name}
      </p>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "end" }}>
        <div>
          <h1 className="section-title">{template.name}</h1>
          <p className="section-lede">{template.description || "Corporate Word template with yellow fillable fields."}</p>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            {template.agreement_type && <span className="badge">{template.agreement_type}</span>}
            {template.jurisdiction && <span className="badge">{template.jurisdiction}</span>}
            {template.entity_scope && <span className="badge">{template.entity_scope}</span>}
            <span className="badge badge--field">
              <span className="field-swatch" />
              {template.field_count} fields
            </span>
          </div>
        </div>
        <Link className="btn btn--solid" href={`/create?template=${template.id}`}>
          Use template
        </Link>
      </div>

      <div className="split" style={{ marginTop: "1.5rem" }}>
        <section className="panel">
          <div className="panel__head">
            <h2 className="section-title" style={{ fontSize: "1.3rem", margin: 0 }}>
              Yellow fields
            </h2>
          </div>
          <div className="panel__body" style={{ padding: 0 }}>
            <table className="table">
              <thead>
                <tr>
                  <th style={{ paddingLeft: "1.25rem" }}>Label</th>
                  <th>Key</th>
                  <th>Placeholder</th>
                  <th>Uses</th>
                </tr>
              </thead>
              <tbody>
                {template.fields.map((field) => (
                  <tr key={field.key}>
                    <td style={{ paddingLeft: "1.25rem" }}>{field.label}</td>
                    <td>
                      <code>{field.key}</code>
                    </td>
                    <td>
                      <span className="badge badge--field">{field.placeholder}</span>
                    </td>
                    <td>{field.occurrence_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel">
          <div className="panel__head">
            <h2 className="section-title" style={{ fontSize: "1.3rem", margin: 0 }}>
              Document preview
            </h2>
          </div>
          <div className="panel__body">
            <div className="preview">{template.preview_text || "No preview text available."}</div>
          </div>
        </section>
      </div>
    </div>
  );
}
