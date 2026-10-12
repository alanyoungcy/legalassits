"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { listContracts, type ContractSummary } from "@/lib/api";

export function InboxApp() {
  const [contracts, setContracts] = useState<ContractSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setBusy(true);
      try {
        const rows = await listContracts();
        if (!cancelled) {
          setContracts(rows);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load inbox");
        }
      } finally {
        if (!cancelled) setBusy(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return contracts;
    return contracts.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.template_name.toLowerCase().includes(q) ||
        (c.counterparty || "").toLowerCase().includes(q),
    );
  }, [contracts, query]);

  return (
    <div className="inbox">
      <aside className="inbox__list">
        <div className="inbox__list-head">
          <h1>Inbox</h1>
          <input
            className="inbox__search"
            placeholder="Search document, name…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="inbox__filters">
            <button type="button" data-active="true">
              All
            </button>
            <span className="muted">{filtered.length} document{filtered.length === 1 ? "" : "s"}</span>
          </div>
        </div>

        {busy && <p className="muted inbox__empty">Loading…</p>}
        {error && <p className="muted inbox__empty">{error}</p>}

        {!busy && !error && filtered.length === 0 && (
          <div className="inbox__empty">
            <div className="inbox__empty-icon" aria-hidden>
              📁
            </div>
            <strong>Empty Inbox</strong>
            <p className="muted">Save a contract from the workspace to see it here.</p>
            <Link className="btn btn--solid" href="/create">
              Create contract
            </Link>
          </div>
        )}

        <ul className="inbox__items">
          {filtered.map((contract) => (
            <li key={contract.id}>
              <Link
                href={`/workspace?contract=${encodeURIComponent(contract.id)}&mode=assess`}
                className="inbox__item"
              >
                <div className="inbox__item-top">
                  <strong>{contract.title}</strong>
                  <span className="badge">{contract.status.replaceAll("_", " ")}</span>
                </div>
                <div className="inbox__item-meta muted">
                  <span>{contract.template_name}</span>
                  <span>
                    {contract.filled_field_count}/{contract.total_field_count} fields
                  </span>
                </div>
                <div className="inbox__item-meta muted">
                  <span>{contract.counterparty || "No counterparty"}</span>
                  <span>{new Date(contract.updated_at).toLocaleString()}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </aside>

      <section className="inbox__preview">
        {filtered[0] ? (
          <div className="inbox__preview-card">
            <h2>{filtered[0].title}</h2>
            <p className="muted">
              {filtered[0].template_name} · {filtered[0].status.replaceAll("_", " ")}
            </p>
            <p>
              Open this draft in the Word workspace to continue completing fields or run an
              Assessment with Capco skills.
            </p>
            <Link
              className="btn btn--solid"
              href={`/workspace?contract=${encodeURIComponent(filtered[0].id)}&mode=assess`}
            >
              Open document
            </Link>
          </div>
        ) : (
          <div className="inbox__preview-empty">
            <p className="muted">Check your contracts and notifications</p>
          </div>
        )}
      </section>
    </div>
  );
}
