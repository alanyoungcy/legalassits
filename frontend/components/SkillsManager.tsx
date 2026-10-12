"use client";

import { useMemo, useState } from "react";
import {
  reindexSkills,
  toggleSkill,
  updateSkill,
  type SkillPlugin,
  type SkillSummary,
} from "@/lib/api";

export function SkillsManager({
  initialPlugins,
  initialSkills,
}: {
  initialPlugins: SkillPlugin[];
  initialSkills: SkillSummary[];
}) {
  const [plugins, setPlugins] = useState(initialPlugins);
  const [skills, setSkills] = useState(initialSkills);
  const [pluginFilter, setPluginFilter] = useState<"all" | "commercial-legal" | "employment-legal">(
    "all",
  );
  const [reviewOnly, setReviewOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(
    initialSkills.find((s) => s.enabled && s.review_capable)?.id || initialSkills[0]?.id || null,
  );
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const filtered = useMemo(() => {
    return skills.filter((skill) => {
      if (pluginFilter !== "all" && skill.plugin !== pluginFilter) return false;
      if (reviewOnly && !skill.review_capable) return false;
      return true;
    });
  }, [skills, pluginFilter, reviewOnly]);

  const selected = skills.find((skill) => skill.id === selectedId) || null;

  async function onToggle(skillId: string) {
    setBusyId(skillId);
    setMessage(null);
    try {
      const updated = await toggleSkill(skillId);
      setSkills((current) => current.map((item) => (item.id === skillId ? { ...item, ...updated } : item)));
      setPlugins((current) =>
        current.map((plugin) => {
          if (plugin.id !== updated.plugin) return plugin;
          const pluginSkills = skills.map((item) =>
            item.id === skillId ? { ...item, ...updated } : item,
          ).filter((item) => item.plugin === plugin.id);
          // recompute from latest toggle locally
          const enabled_count = pluginSkills.filter((s) =>
            s.id === skillId ? updated.enabled : s.enabled,
          ).length;
          const review_count = pluginSkills.filter((s) => {
            const enabled = s.id === skillId ? updated.enabled : s.enabled;
            return enabled && s.review_capable;
          }).length;
          return { ...plugin, enabled_count, review_count };
        }),
      );
      setMessage(`${updated.name} ${updated.enabled ? "enabled" : "disabled"}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Toggle failed");
    } finally {
      setBusyId(null);
    }
  }

  async function onFavorite(skillId: string, favorite: boolean) {
    setBusyId(skillId);
    try {
      const updated = await updateSkill(skillId, { favorite });
      setSkills((current) => current.map((item) => (item.id === skillId ? { ...item, ...updated } : item)));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Update failed");
    } finally {
      setBusyId(null);
    }
  }

  async function onNotes(skillId: string, notes: string) {
    try {
      const updated = await updateSkill(skillId, { notes });
      setSkills((current) => current.map((item) => (item.id === skillId ? { ...item, ...updated } : item)));
      setMessage("Notes saved");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Save failed");
    }
  }

  async function onReindex() {
    setBusyId("reindex");
    setMessage(null);
    try {
      const next = await reindexSkills();
      setSkills(next);
      setMessage(`${next.length} skills reindexed from anthropics/claude-for-legal`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Reindex failed");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "end" }}>
        <div>
          <h1 className="section-title">Skills</h1>
          <p className="section-lede">
            Manage review skills vendored from{" "}
            <a href="https://github.com/anthropics/claude-for-legal" target="_blank" rel="noreferrer">
              anthropics/claude-for-legal
            </a>
            . Focus packs: commercial-legal and employment-legal.
          </p>
        </div>
        <button className="btn" type="button" onClick={() => void onReindex()} disabled={busyId === "reindex"}>
          {busyId === "reindex" ? "Indexing…" : "Reindex skills"}
        </button>
      </div>

      <div className="grid grid--tiles" style={{ marginBottom: "1.25rem" }}>
        {plugins.map((plugin) => (
          <button
            key={plugin.id}
            type="button"
            className="tile"
            style={{
              textAlign: "left",
              cursor: "pointer",
              borderColor: pluginFilter === plugin.id ? "var(--capco-white)" : undefined,
            }}
            onClick={() =>
              setPluginFilter((current) => (current === plugin.id ? "all" : (plugin.id as typeof pluginFilter)))
            }
          >
            <h3>{plugin.name}</h3>
            <p>
              {plugin.enabled_count}/{plugin.skill_count} enabled · {plugin.review_count} review-ready
              {plugin.version ? ` · v${plugin.version}` : ""}
            </p>
          </button>
        ))}
      </div>

      <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1rem", flexWrap: "wrap", alignItems: "center" }}>
        <button
          type="button"
          className={`btn ${pluginFilter === "all" ? "btn--solid" : "btn--ghost"}`}
          onClick={() => setPluginFilter("all")}
        >
          All plugins
        </button>
        <label className="muted" style={{ display: "inline-flex", gap: "0.45rem", alignItems: "center" }}>
          <input
            type="checkbox"
            checked={reviewOnly}
            onChange={(event) => setReviewOnly(event.target.checked)}
          />
          Review skills only
        </label>
        {message && <span className="muted">{message}</span>}
      </div>

      <div className="split">
        <section className="panel">
          <div className="panel__head">
            <h2 className="section-title" style={{ fontSize: "1.25rem", margin: 0 }}>
              Skill catalog
            </h2>
          </div>
          <div className="panel__body" style={{ padding: 0 }}>
            <table className="table">
              <thead>
                <tr>
                  <th style={{ paddingLeft: "1.25rem" }}>Skill</th>
                  <th>Plugin</th>
                  <th>Review</th>
                  <th>Enabled</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((skill) => (
                  <tr
                    key={skill.id}
                    onClick={() => setSelectedId(skill.id)}
                    style={{
                      cursor: "pointer",
                      background:
                        selectedId === skill.id ? "rgba(255,255,255,0.04)" : undefined,
                    }}
                  >
                    <td style={{ paddingLeft: "1.25rem" }}>
                      <strong>{skill.name}</strong>
                      <div className="muted" style={{ fontSize: "0.8rem", marginTop: "0.2rem" }}>
                        {skill.description.slice(0, 120)}
                        {skill.description.length > 120 ? "…" : ""}
                      </div>
                    </td>
                    <td>
                      <span className="badge">{skill.plugin}</span>
                    </td>
                    <td>
                      {skill.review_capable ? (
                        <span className="badge badge--field">review</span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>
                      <button
                        type="button"
                        className={`btn ${skill.enabled ? "btn--solid" : "btn--ghost"}`}
                        style={{ minHeight: "2rem", padding: "0.35rem 0.7rem" }}
                        disabled={busyId === skill.id}
                        onClick={(event) => {
                          event.stopPropagation();
                          void onToggle(skill.id);
                        }}
                      >
                        {skill.enabled ? "On" : "Off"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel">
          <div className="panel__head">
            <h2 className="section-title" style={{ fontSize: "1.25rem", margin: 0 }}>
              Skill detail
            </h2>
          </div>
          <div className="panel__body">
            {!selected ? (
              <p className="muted">Select a skill to manage.</p>
            ) : (
              <>
                <p style={{ marginTop: 0 }}>
                  <strong>{selected.name}</strong>
                </p>
                <p className="muted">{selected.description}</p>
                <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1rem" }}>
                  <span className="badge">{selected.plugin}</span>
                  {selected.review_capable && <span className="badge badge--field">review</span>}
                  {selected.favorite && <span className="badge">favorite</span>}
                  <span className="badge">{selected.enabled ? "enabled" : "disabled"}</span>
                </div>
                <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1rem" }}>
                  <button
                    type="button"
                    className="btn"
                    disabled={busyId === selected.id}
                    onClick={() => void onToggle(selected.id)}
                  >
                    {selected.enabled ? "Disable" : "Enable"}
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost"
                    disabled={busyId === selected.id}
                    onClick={() => void onFavorite(selected.id, !selected.favorite)}
                  >
                    {selected.favorite ? "Unfavorite" : "Favorite"}
                  </button>
                </div>
                <div className="field">
                  <label htmlFor="notes">Capco notes</label>
                  <textarea
                    id="notes"
                    rows={4}
                    defaultValue={selected.notes}
                    key={`${selected.id}-${selected.notes}`}
                    onBlur={(event) => {
                      if (event.target.value !== selected.notes) {
                        void onNotes(selected.id, event.target.value);
                      }
                    }}
                  />
                  <span className="field__hint">Saved on blur. Used as local operator notes for this skill.</span>
                </div>
                {selected.headings && selected.headings.length > 0 && (
                  <>
                    <p className="muted" style={{ marginTop: "1.25rem" }}>
                      Workflow sections
                    </p>
                    <ul>
                      {selected.headings.slice(0, 12).map((heading, index) => (
                        <li key={`${index}-${heading}`}>{heading}</li>
                      ))}
                    </ul>
                  </>
                )}
                {selected.body_preview && (
                  <pre className="preview" style={{ marginTop: "1rem" }}>
                    {selected.body_preview}
                  </pre>
                )}
              </>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
