"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { createReview, type ReviewSummary, type SkillSummary } from "@/lib/api";

export function ReviewPanel({
  contractId,
  reviewSkills,
  initialReviews,
}: {
  contractId: string;
  reviewSkills: SkillSummary[];
  initialReviews: ReviewSummary[];
}) {
  const enabledSkills = useMemo(
    () => reviewSkills.filter((skill) => skill.enabled),
    [reviewSkills],
  );
  const [skillId, setSkillId] = useState(enabledSkills[0]?.id || "");
  const [side, setSide] = useState("purchasing");
  const [reviews, setReviews] = useState(initialReviews);
  const [active, setActive] = useState<ReviewSummary | null>(initialReviews[0] || null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onRun() {
    setBusy(true);
    setError(null);
    try {
      const review = await createReview({
        contract_id: contractId,
        skill_id: skillId || undefined,
        side,
      });
      setReviews((current) => [review, ...current]);
      setActive(review);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Review failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel" style={{ marginTop: "1rem" }}>
      <div className="panel__head">
        <div>
          <h2 className="section-title" style={{ fontSize: "1.3rem", margin: 0 }}>
            Skill review
          </h2>
          <p className="muted" style={{ margin: "0.35rem 0 0" }}>
            Routes through enabled commercial / employment skills.{" "}
            <Link href="/skills">Manage skills</Link>
          </p>
        </div>
      </div>
      <div className="panel__body">
        <div className="form-grid">
          <div className="field">
            <label htmlFor="skill">Review skill</label>
            <select
              id="skill"
              value={skillId}
              onChange={(event) => setSkillId(event.target.value)}
            >
              <option value="">Auto-route from agreement type</option>
              {enabledSkills.map((skill) => (
                <option key={skill.id} value={skill.id}>
                  {skill.plugin} / {skill.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="side">Commercial side</label>
            <select id="side" value={side} onChange={(event) => setSide(event.target.value)}>
              <option value="purchasing">Purchasing-side</option>
              <option value="sales">Sales-side</option>
            </select>
          </div>
          <div className="field--full">
            <button className="btn btn--solid" type="button" onClick={() => void onRun()} disabled={busy}>
              {busy ? "Running…" : "Run skill review"}
            </button>
            {error && <p className="muted">{error}</p>}
          </div>
        </div>

        {reviews.length > 0 && (
          <div style={{ marginTop: "1.25rem" }}>
            <p className="muted">Prior runs</p>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1rem" }}>
              {reviews.map((review) => (
                <button
                  key={review.id}
                  type="button"
                  className={`btn ${active?.id === review.id ? "btn--solid" : "btn--ghost"}`}
                  style={{ minHeight: "2rem", padding: "0.35rem 0.7rem" }}
                  onClick={() => setActive(review)}
                >
                  {review.triage || "REVIEW"} · {review.skill_name}
                </button>
              ))}
            </div>
          </div>
        )}

        {active && (
          <>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1rem" }}>
              <span className="badge badge--field">{active.triage || "REVIEW"}</span>
              <span className="badge">{active.skill_id}</span>
              <span className="badge">{active.status.replaceAll("_", " ")}</span>
            </div>
            <p className="muted">{active.disclaimer}</p>
            <h3 style={{ fontFamily: "var(--font-display)", fontSize: "1.15rem" }}>Findings</h3>
            <ul>
              {active.findings.map((finding, index) => (
                <li key={`${finding.title}-${index}`}>
                  <strong>{finding.severity}</strong> — {finding.title}: {finding.detail}
                </li>
              ))}
            </ul>
            <h3 style={{ fontFamily: "var(--font-display)", fontSize: "1.15rem" }}>Memo</h3>
            <pre className="preview">{active.memo}</pre>
          </>
        )}
      </div>
    </section>
  );
}
