"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { reindexTemplates } from "@/lib/api";

export function ReindexButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function onClick() {
    setBusy(true);
    setMessage(null);
    try {
      const templates = await reindexTemplates();
      setMessage(`${templates.length} template(s) indexed`);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Reindex failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "0.4rem" }}>
      <button className="btn" type="button" onClick={onClick} disabled={busy}>
        {busy ? "Indexing…" : "Reindex templates"}
      </button>
      {message && <span className="muted" style={{ fontSize: "0.8rem" }}>{message}</span>}
    </div>
  );
}
