import Link from "next/link";
import { listContracts } from "@/lib/api";

export default async function ContractsPage() {
  let contracts: Awaited<ReturnType<typeof listContracts>> = [];
  let error: string | null = null;
  try {
    contracts = await listContracts();
  } catch (err) {
    error = err instanceof Error ? err.message : "Failed to load contracts";
  }

  return (
    <div className="page">
      <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "end" }}>
        <div>
          <h1 className="section-title">Contracts</h1>
          <p className="section-lede">Drafts generated from the corporate template library.</p>
        </div>
        <Link className="btn btn--solid" href="/create">
          New draft
        </Link>
      </div>
      {error && <p className="muted">{error}</p>}
      <section className="panel">
        <div className="panel__body" style={{ padding: 0 }}>
          <table className="table">
            <thead>
              <tr>
                <th style={{ paddingLeft: "1.25rem" }}>Title</th>
                <th>Template</th>
                <th>Status</th>
                <th>Fields</th>
                <th>Counterparty</th>
              </tr>
            </thead>
            <tbody>
              {contracts.map((contract) => (
                <tr key={contract.id}>
                  <td style={{ paddingLeft: "1.25rem" }}>
                    <Link href={`/contracts/${contract.id}`}>
                      <strong>{contract.title}</strong>
                    </Link>
                  </td>
                  <td>{contract.template_name}</td>
                  <td>
                    <span className="badge">{contract.status.replaceAll("_", " ")}</span>
                  </td>
                  <td>
                    {contract.filled_field_count}/{contract.total_field_count}
                  </td>
                  <td>{contract.counterparty || "—"}</td>
                </tr>
              ))}
              {contracts.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ padding: "1.25rem" }} className="muted">
                    No contracts yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
