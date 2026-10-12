import Link from "next/link";
import { notFound } from "next/navigation";
import { ReviewPanel } from "@/components/ReviewPanel";
import {
  downloadContractUrl,
  getContract,
  listReviews,
  listSkills,
} from "@/lib/api";

export default async function ContractDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let contract: Awaited<ReturnType<typeof getContract>>;
  try {
    contract = await getContract(id);
  } catch {
    notFound();
  }

  let reviewSkills: Awaited<ReturnType<typeof listSkills>> = [];
  let reviews: Awaited<ReturnType<typeof listReviews>> = [];
  try {
    [reviewSkills, reviews] = await Promise.all([
      listSkills({ review_only: true }),
      listReviews(id),
    ]);
  } catch {
    // Review panel can still render empty if API subset fails
  }

  return (
    <div className="page">
      <p className="muted" style={{ marginTop: 0 }}>
        <Link href="/contracts">Contracts</Link> / {contract.title}
      </p>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "end" }}>
        <div>
          <h1 className="section-title">{contract.title}</h1>
          <p className="section-lede">
            From template <Link href={`/templates/${contract.template_id}`}>{contract.template_name}</Link>
          </p>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <span className="badge">{contract.status.replaceAll("_", " ")}</span>
            {contract.legal_entity && <span className="badge">{contract.legal_entity}</span>}
            {contract.governing_law && <span className="badge">{contract.governing_law}</span>}
          </div>
        </div>
        <a className="btn btn--solid" href={downloadContractUrl(contract.id)}>
          Download Word
        </a>
      </div>

      <div className="split" style={{ marginTop: "1.5rem" }}>
        <section className="panel">
          <div className="panel__head">
            <h2 className="section-title" style={{ fontSize: "1.3rem", margin: 0 }}>
              Field values
            </h2>
          </div>
          <div className="panel__body" style={{ padding: 0 }}>
            <table className="table">
              <thead>
                <tr>
                  <th style={{ paddingLeft: "1.25rem" }}>Field</th>
                  <th>Value</th>
                  <th>State</th>
                </tr>
              </thead>
              <tbody>
                {contract.fields.map((field) => {
                  const value = contract.field_values[field.key] || "";
                  return (
                    <tr key={field.key}>
                      <td style={{ paddingLeft: "1.25rem" }}>{field.label}</td>
                      <td>{value || <span className="muted">—</span>}</td>
                      <td>
                        {value ? (
                          <span className="badge">filled</span>
                        ) : (
                          <span className="badge badge--field">missing</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
        <section className="panel">
          <div className="panel__head">
            <h2 className="section-title" style={{ fontSize: "1.3rem", margin: 0 }}>
              Completeness
            </h2>
          </div>
          <div className="panel__body">
            <p>
              {contract.filled_field_count} of {contract.total_field_count} fields filled.
            </p>
            {contract.missing_fields.length > 0 ? (
              <>
                <p className="muted">Still missing:</p>
                <ul>
                  {contract.missing_fields.map((key) => (
                    <li key={key}>
                      <code>{key}</code>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p>All required yellow fields are filled. Run a skill review before circulation.</p>
            )}
          </div>
        </section>
      </div>

      <ReviewPanel
        contractId={contract.id}
        reviewSkills={reviewSkills}
        initialReviews={reviews}
      />
    </div>
  );
}
