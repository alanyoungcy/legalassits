"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { aiChatStream } from "@/lib/api";
import {
  followUpPrompt,
  parseAssignedValues,
} from "@/lib/fieldAssign";

export type CopilotField = {
  key: string;
  label: string;
  placeholder: string;
  value?: string;
};

type Msg = { role: "user" | "assistant"; content: string };

type PanelId =
  | "workflow"
  | "variables"
  | "wayne"
  | "history"
  | "comments"
  | "compare"
  | "version"
  | "info";

type ClauseSection = {
  id: string;
  title: string;
  body: string;
};

type WorkflowPerson = { id: string; name: string; role: string };

const DEFAULT_CLAUSE_SECTIONS: ClauseSection[] = [
  {
    id: "insights",
    title: "Wayne Insights",
    body: "AI-generated overview of risks, missing fields, and playbook hotspots for this document.",
  },
  {
    id: "preamble",
    title: "Preamble And Parties",
    body: "Parties, effective date, and capacity language. Confirm legal entity names and addresses match Variables.",
  },
  {
    id: "definitions",
    title: "1. Definitions",
    body: "1.1 Confidential Information — scope of protected materials.\n1.2 Exclusions — public / independently developed / required by law.\n1.3 Term — confidentiality duration and survival.",
  },
  {
    id: "obligations",
    title: "2. Obligations",
    body: "Use restrictions, need-to-know sharing, and security expectations for the receiving party.",
  },
  {
    id: "term",
    title: "3. Term And Termination",
    body: "Agreement length, renewal, and return/destruction of confidential materials.",
  },
  {
    id: "governing",
    title: "4. Governing Law",
    body: "Jurisdiction, venue, and dispute resolution. Flag non-HK/UK/SG choices for attorney review.",
  },
];

function clausesFromDocument(plainText?: string, missingFields = 0): ClauseSection[] {
  const text = (plainText || "").trim();
  if (!text) return DEFAULT_CLAUSE_SECTIONS;

  const insights: ClauseSection = {
    id: "insights",
    title: "Wayne Insights",
    body:
      missingFields > 0
        ? `${missingFields} yellow field(s) remain empty. Review parties, duration, and governing law before circulation.`
        : "Variables look complete. Run Understand & Assess for playbook findings before approval.",
  };

  const chunks = text.split(/\n(?=\d+\.\s+[A-Z])/).filter((c) => c.trim().length > 40);
  if (chunks.length >= 2) {
    const sections: ClauseSection[] = [insights];
    chunks.slice(0, 8).forEach((chunk, index) => {
      const first = chunk.trim().split(/\n/)[0].slice(0, 80);
      sections.push({
        id: `clause-${index}`,
        title: first || `Clause ${index + 1}`,
        body: chunk.trim().slice(0, 1200),
      });
    });
    return sections;
  }

  return [
    insights,
    {
      id: "preamble",
      title: "Preamble And Parties",
      body: text.slice(0, 800),
    },
    ...DEFAULT_CLAUSE_SECTIONS.slice(2),
  ];
}

type Props = {
  copilotName: string;
  title: string;
  agreementType?: string | null;
  plainText?: string;
  fields: CopilotField[];
  values: Record<string, string>;
  onValuesChange: (values: Record<string, string>) => void;
  /** Write field values into the live Word document; returns how many fields synced. */
  onApplyFields?: (updates: Record<string, string>) => number | Promise<number>;
  configured: boolean | null;
  initialMode?: "understand" | "improve" | "sources" | "review" | "assess" | "complete";
  initialPrompt?: string;
  /** Blank Create workspace — show Templates / Upload / AI draft chooser. */
  freshStart?: boolean;
  /** After open, auto-run Capco skills assessment (document unchanged). */
  autoStartAssess?: boolean;
  onBrowseTemplates?: () => void;
  onUploadDocument?: () => void;
};

type ChatMode = "understand" | "improve" | "sources" | "review" | "assess" | "complete";

export function CapcoWaynePanel({
  copilotName,
  title,
  agreementType,
  plainText,
  fields,
  values,
  onValuesChange,
  onApplyFields,
  configured,
  initialMode = "understand",
  initialPrompt,
  freshStart = false,
  autoStartAssess = false,
  onBrowseTemplates,
  onUploadDocument,
}: Props) {
  const [panel, setPanel] = useState<PanelId>("wayne");
  const [wayneView, setWayneView] = useState<"chat" | "clauses">("chat");
  const [clauseTab, setClauseTab] = useState<"available" | "financial">("available");
  const [openClauses, setOpenClauses] = useState<Record<string, boolean>>({
    insights: true,
    definitions: true,
  });
  const [chatMode, setChatMode] = useState<ChatMode>(
    initialMode === "review" || initialMode === "understand" ? "assess" : initialMode,
  );
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [activeSkill, setActiveSkill] = useState<{ id: string; name?: string } | null>(null);
  const [relatedOpen, setRelatedOpen] = useState(false);
  const [showStartChooser, setShowStartChooser] = useState(freshStart);
  const autoAssessStarted = useRef(false);
  const [workflowTab, setWorkflowTab] = useState<"content" | "create">("create");
  const [approvers, setApprovers] = useState<WorkflowPerson[]>([
    { id: "ay", name: "Alan Young", role: "Initiator" },
  ]);
  const [signatories, setSignatories] = useState<WorkflowPerson[]>([]);
  const [ccs, setCcs] = useState<WorkflowPerson[]>([]);
  const [history, setHistory] = useState<string[]>([]);

  const filledCount = useMemo(
    () => fields.filter((f) => (values[f.key] || "").trim()).length,
    [fields, values],
  );

  const involvedParties = useMemo(() => {
    const keys = ["disclosing_party", "receiving_party", "client_name", "capco_legal_entity"];
    const parts = keys.map((k) => values[k]).filter(Boolean);
    return parts.length ? parts.join(" · ") : "NA";
  }, [values]);

  const duration = values.confidentiality_term || values.duration || "NA";

  const highlights = useMemo(() => {
    const text = (plainText || "").toLowerCase();
    const items: string[] = [];
    if (text.includes("confidential")) {
      items.push("Receiving party must keep shared information secret and limit use to the stated purpose.");
    }
    if (text.includes("mutual") || agreementType?.toUpperCase() === "NDA") {
      items.push("Template is structured as a confidentiality agreement between two companies.");
    }
    if (fields.length) {
      items.push(`${fields.length - filledCount} yellow field(s) still need values before circulation.`);
    }
    if (!items.length) {
      items.push("Open Capco Wayne chat to generate key highlights from the live document.");
    }
    return items.slice(0, 5);
  }, [plainText, agreementType, fields.length, filledCount]);

  const clauseSections = useMemo(
    () => clausesFromDocument(plainText, Math.max(0, fields.length - filledCount)),
    [plainText, fields.length, filledCount],
  );

  useEffect(() => {
    if (freshStart && !fields.length) {
      setShowStartChooser(true);
      setMessages([
        {
          role: "assistant",
          content:
            `Welcome — this is a **fresh blank document**.\n\n` +
            `Choose how you'd like to get started. You can begin with a ready-made template, ` +
            `upload an existing document, or let me draft a contract from your requirements.`,
        },
      ]);
      setChatMode("improve");
      setHistory((h) => [`Create · blank workspace · ${new Date().toLocaleString()}`, ...h].slice(0, 20));
      if (initialPrompt) setInput(initialPrompt);
      return;
    }

    setShowStartChooser(false);
    const assessMode =
      autoStartAssess || initialMode === "assess" || initialMode === "review";
    const empty = fields.filter((f) => !(values[f.key] || "").trim());
    const first = empty[0];

    if (assessMode) {
      const intro =
        `I've opened **${title || "your document"}** for **Assessment**.\n\n` +
        `I'll keep the Word document unchanged, explain what this agreement is about, ` +
        `and run a Capco skills playbook review (GREEN / YELLOW / RED risks).\n\n` +
        (autoStartAssess
          ? `_Starting assessment now…_`
          : `Click **Assessment** or ask me to review when you're ready.`);
      setMessages([{ role: "assistant", content: intro }]);
      setChatMode("assess");
      setHistory((h) => [
        `Assessment · “${title}” · ${new Date().toLocaleString()}`,
        ...h,
      ].slice(0, 20));
      if (initialPrompt) setInput(initialPrompt);
      return;
    }

    const intro =
      `I've opened **${title || "this document"}** for editing. Yellow highlights are Variables — ` +
      `I'll write your answers straight into the Word document as we go.\n\n` +
      `**Background**\n` +
      `${agreementType === "NDA" || (plainText || "").toLowerCase().includes("non-disclosure")
        ? "This NDA sets confidentiality rules when one company shares sensitive information with another."
        : "This agreement establishes the commercial terms and obligations between the parties."}\n\n` +
      `**Involved Parties** ${involvedParties}\n` +
      `**Duration** ${duration}\n` +
      `**Fields to complete** ${empty.length}/${fields.length || 0}\n\n` +
      `**Key Highlights**\n` +
      highlights.map((h) => `• ${h}`).join("\n") +
      `\n\n` +
      (first
        ? `Let's finish this together. **First:** who are the parties, what's the effective date, and governing law?\n` +
          `(Or answer just for **${first.label || first.placeholder}**.)`
        : `All yellow fields look filled — I can **review and analyse** this contract next.`);
    setMessages([{ role: "assistant", content: intro }]);
    setChatMode(fields.length && empty.length ? "complete" : initialMode);
    setHistory((h) => [
      `Opened “${title}” · ${new Date().toLocaleString()}`,
      ...h,
    ].slice(0, 20));
    if (initialPrompt) setInput(initialPrompt);
  }, [freshStart, autoStartAssess, initialMode, title, agreementType, fields.map((f) => f.key).join("|")]); // eslint-disable-line react-hooks/exhaustive-deps

  function startAiDraft() {
    setShowStartChooser(false);
    setChatMode("improve");
    setPanel("wayne");
    setWayneView("chat");
    void sendChat(
      "I want to draft a new contract with AI on this blank document. " +
        "Ask me the agreement type (NDA, MSA, SOW, employment, etc.), parties, governing law, " +
        "and the key commercial terms. Then propose a structured clause outline I can refine. " +
        "Do not invent party names — ask first.",
      "improve",
    );
  }

  const relatedQueries: Array<{ label: string; mode?: ChatMode }> = [
    {
      label: "Help me complete every yellow field — ask me one question at a time",
      mode: "complete",
    },
    { label: "Assess this contract with Capco skills playbook", mode: "assess" },
    { label: "List GREEN / YELLOW / RED findings", mode: "assess" },
    { label: "Summarize obligations and renewal risks", mode: "assess" },
  ];

  async function commitFieldUpdates(assigned: Record<string, string>, baseValues = values) {
    if (!Object.keys(assigned).length) {
      return { merged: baseValues, applied: 0, assignedCount: 0 };
    }
    const merged = { ...baseValues, ...assigned };
    onValuesChange(merged);
    const applied = (await onApplyFields?.(assigned)) ?? 0;
    return { merged, applied, assignedCount: Object.keys(assigned).length };
  }

  async function sendChat(text?: string, modeOverride?: ChatMode) {
    const content = (text ?? input).trim();
    if (!content) return;

    // Assessment must never fill the Word document. Do not treat "NDA" alone as complete.
    const wantsAssess =
      modeOverride === "assess" ||
      modeOverride === "review" ||
      modeOverride === "understand" ||
      chatMode === "assess" ||
      /\b(review|assess|analyse|analyze|triage|playbook|findings?|green|yellow|red)\b/i.test(
        content,
      );
    const wantsComplete =
      !wantsAssess &&
      (modeOverride === "complete" ||
        /\b(complete|fill|yellow field|assign variable|one question at a time)\b/i.test(content) ||
        chatMode === "complete");
    const mode: ChatMode = modeOverride
      ? modeOverride === "review" || modeOverride === "understand"
        ? "assess"
        : modeOverride
      : wantsAssess
        ? "assess"
        : wantsComplete
          ? "complete"
          : chatMode;
    const mayWriteDocument = mode === "complete";
    const isAssessment = mode === "assess" || mode === "review" || mode === "understand";
    if (mayWriteDocument) setChatMode("complete");
    else if (isAssessment) setChatMode("assess");

    const nextMessages: Msg[] = [...messages, { role: "user", content }];
    setMessages([...nextMessages, { role: "assistant", content: "" }]);
    setInput("");
    setBusy(true);
    setHistory((h) => [`You: ${content.slice(0, 80)}`, ...h].slice(0, 20));

    let liveValues = { ...values };
    let totalApplied = 0;
    const appliedKeys = new Set<string>();
    let lastFieldsFence = "";
    let usedSkill: { id: string; name?: string } | null = null;

    const syncFieldsFromText = async (full: string) => {
      if (!mayWriteDocument) return;
      const assigned = parseAssignedValues(full, fields);
      const fresh: Record<string, string> = {};
      for (const [key, val] of Object.entries(assigned)) {
        if (appliedKeys.has(key) && liveValues[key] === val) continue;
        if (!val?.trim()) continue;
        fresh[key] = val;
      }
      if (!Object.keys(fresh).length) return;
      const { merged, applied } = await commitFieldUpdates(fresh, liveValues);
      liveValues = merged;
      totalApplied += applied;
      for (const key of Object.keys(fresh)) appliedKeys.add(key);
    };

    try {
      const emptyKeys = fields
        .filter((f) => !(values[f.key] || "").trim())
        .map((f) => f.key)
        .join(", ");
      const guided = mayWriteDocument
        ? `${content}\n\n[System: Emit a \`\`\`fields key: value\`\`\` block EARLY using exact keys, then keep talking. ` +
          `Empty keys now: ${emptyKeys || "(none)"}. Ask one question for the next empty field. ` +
          `Values sync into the live Word document as you stream.]`
        : `${content}\n\n[System: ASSESSMENT MODE. Follow the Active Capco skill playbook loaded for you. ` +
          `Do NOT emit a \`\`\`fields block. Do NOT change document field values. ` +
          `Keep the Word document unchanged. Put GREEN/YELLOW/RED findings in chat only.]`;

      const full = await aiChatStream(
        {
          messages: [
            ...nextMessages.slice(0, -1).map((m) => ({ role: m.role, content: m.content })),
            { role: "user", content: guided },
          ],
          mode: mayWriteDocument ? "complete" : "assess",
          document_title: title,
          document_text: plainText || "",
          agreement_type: agreementType || undefined,
          fields: fields.map((f) => ({
            key: f.key,
            label: f.label,
            placeholder: f.placeholder,
            value: values[f.key] || "",
          })),
        },
        (_delta, accumulated) => {
          setMessages((current) => {
            const copy = [...current];
            const last = copy[copy.length - 1];
            if (last?.role === "assistant") {
              copy[copy.length - 1] = {
                role: "assistant",
                content: accumulated || "…",
              };
            }
            return copy;
          });
          if (!mayWriteDocument) return;
          const fence = accumulated.match(/```fields[\s\S]*?```/i)?.[0] || "";
          if (fence && fence !== lastFieldsFence) {
            lastFieldsFence = fence;
            void syncFieldsFromText(accumulated);
          }
        },
        undefined,
        (meta) => {
          if (meta.skill_id) {
            usedSkill = { id: meta.skill_id, name: meta.skill_name };
            setActiveSkill(usedSkill);
          }
        },
      );

      if (mayWriteDocument) await syncFieldsFromText(full);
      const assigned = mayWriteDocument ? parseAssignedValues(full, fields) : {};
      const followUp =
        mayWriteDocument && (mode === "complete" || Object.keys(assigned).length)
          ? followUpPrompt(fields, liveValues, totalApplied, {
              assignedCount: Object.keys(assigned).length,
            })
          : "";
      const syncNote =
        mayWriteDocument && totalApplied
          ? `\n\n✓ Wrote **${totalApplied}** value(s) into the Word document.`
          : mayWriteDocument && Object.keys(assigned).length
            ? `\n\n⚠ Captured values in Variables but the Word canvas may not have updated.`
            : "";
      const skillNote =
        isAssessment && usedSkill
          ? `\n\n_Assessment skill: **${usedSkill.name || usedSkill.id}** (\`${usedSkill.id}\`)_`
          : "";
      const body =
        full.replace(/```fields[\s\S]*?```/gi, "").trim() +
        syncNote +
        skillNote +
        (followUp ? `\n\n${followUp}` : "");
      setMessages((current) => {
        const copy = [...current];
        copy[copy.length - 1] = { role: "assistant", content: body };
        return copy;
      });
      setHistory((h) => [
        mayWriteDocument && totalApplied
          ? `Synced ${totalApplied} field(s) into document`
          : mayWriteDocument && Object.keys(assigned).length
            ? `Variables updated; document sync missed`
            : isAssessment
              ? `${copilotName}: assessment via ${usedSkill?.id || "skills"} (document unchanged)`
              : `${copilotName}: replied`,
        ...h,
      ].slice(0, 20));
    } catch (err) {
      setMessages((current) => {
        const copy = [...current];
        copy[copy.length - 1] = {
          role: "assistant",
          content: err instanceof Error ? err.message : "Chat failed",
        };
        return copy;
      });
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!autoStartAssess || autoAssessStarted.current || freshStart) return;
    // Wait until document text (or at least a title) is available
    if (!(plainText || "").trim() && !(title || "").trim()) return;
    autoAssessStarted.current = true;
    const timer = window.setTimeout(() => {
      void sendChat(
        "Assess this uploaded contract now.\n\n" +
          "1) Briefly explain what the agreement is about (type, parties, purpose, structure).\n" +
          "2) Run a Capco skills playbook assessment with GREEN / YELLOW / RED findings, " +
          "clause cites, risks, and recommendations.\n" +
          "Do NOT emit ```fields blocks and do NOT change any document values.",
        "assess",
      );
    }, 500);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire once when doc is ready
  }, [autoStartAssess, freshStart, plainText, title]);

  function addWorkflowPerson(
    list: WorkflowPerson[],
    setList: (next: WorkflowPerson[]) => void,
    role: string,
  ) {
    const name = window.prompt(`Add ${role} name`);
    if (!name?.trim()) return;
    setList([...list, { id: `${Date.now()}`, name: name.trim(), role }]);
  }

  async function assignVariables() {
    const empty = fields.filter((f) => !(values[f.key] || "").trim());
    if (!empty.length) {
      setPanel("wayne");
      setWayneView("chat");
      setMessages((m) => [
        ...m,
        { role: "assistant", content: "All Variables already have values. Ask me to refine any field." },
      ]);
      return;
    }
    setBusy(true);
    setPanel("wayne");
    setWayneView("chat");
    const prompt =
      "Suggest values for all empty variables. Emit a ```fields key: value``` block first using these keys:\n" +
      empty.map((f) => `- ${f.key} (${f.label || f.placeholder})`).join("\n");
    const nextMessages: Msg[] = [
      ...messages,
      { role: "user", content: "Assign values to empty Variables." },
    ];
    setMessages([...nextMessages, { role: "assistant", content: "" }]);
    let liveValues = { ...values };
    let totalApplied = 0;
    try {
      const full = await aiChatStream(
        {
          messages: [...nextMessages, { role: "user", content: prompt }].map((m) => ({
            role: m.role,
            content: m.content,
          })),
          mode: "complete",
          document_title: title,
          document_text: plainText || "",
          fields: fields.map((f) => ({
            key: f.key,
            label: f.label,
            placeholder: f.placeholder,
            value: values[f.key] || "",
          })),
        },
        (_delta, accumulated) => {
          setMessages((current) => {
            const copy = [...current];
            copy[copy.length - 1] = { role: "assistant", content: accumulated };
            return copy;
          });
          if (/```fields[\s\S]*?```/i.test(accumulated)) {
            const assigned = parseAssignedValues(accumulated, empty);
            if (Object.keys(assigned).length) {
              void commitFieldUpdates(assigned, liveValues).then(({ merged, applied }) => {
                liveValues = merged;
                totalApplied += applied;
              });
            }
          }
        },
      );
      const assigned = parseAssignedValues(full, empty);
      const { merged, applied, assignedCount } = await commitFieldUpdates(assigned, liveValues);
      totalApplied += applied;
      const followUp = followUpPrompt(fields, merged, totalApplied, { assignedCount });
      setMessages((current) => {
        const copy = [...current];
        copy[copy.length - 1] = {
          role: "assistant",
          content:
            (totalApplied
              ? `Wrote **${totalApplied}** value(s) into the Word document.\n\n`
              : assignedCount
                ? "Parsed suggestions but the Word canvas did not update — check Variables and try again.\n\n"
                : "Could not parse structured assignments — review suggestions below.\n\n") +
            full.replace(/```fields[\s\S]*?```/gi, "").trim() +
            `\n\n${followUp}`,
        };
        return copy;
      });
      setHistory((h) => [
        totalApplied ? `Synced ${totalApplied} variables into document` : `Assign: ${assignedCount} parsed`,
        ...h,
      ].slice(0, 20));
    } catch (err) {
      setMessages((current) => {
        const copy = [...current];
        copy[copy.length - 1] = {
          role: "assistant",
          content: err instanceof Error ? err.message : "Assign failed",
        };
        return copy;
      });
    } finally {
      setBusy(false);
    }
  }

  const rail: Array<{ id: PanelId; label: string; icon: string }> = [
    { id: "workflow", label: "Workflow", icon: "＋" },
    { id: "variables", label: "Variables", icon: "{ }" },
    { id: "wayne", label: copilotName, icon: "CW" },
    { id: "history", label: "History", icon: "◷" },
    { id: "comments", label: "Comments", icon: "💬" },
    { id: "compare", label: "Compare", icon: "⇄" },
    { id: "version", label: "Version", icon: "⊕" },
    { id: "info", label: "Info", icon: "ℹ" },
  ];

  return (
    <aside className="wayne-panel">
      <nav className="wayne-rail" aria-label="Copilot sections">
        {rail.map((item) => (
          <button
            key={item.id}
            type="button"
            className="wayne-rail__btn"
            data-active={panel === item.id ? "true" : "false"}
            title={item.label}
            onClick={() => setPanel(item.id)}
          >
            <span className={item.id === "wayne" ? "wayne-rail__avatar" : undefined}>{item.icon}</span>
            <span className="wayne-rail__label">{item.label}</span>
          </button>
        ))}
      </nav>

      <div className="wayne-panel__main">
        {panel === "wayne" && (
          <>
            <div className="wayne-panel__head">
              <div className="wayne-panel__head-tabs">
                <button
                  type="button"
                  data-active={wayneView === "chat" ? "true" : "false"}
                  onClick={() => setWayneView("chat")}
                >
                  New Chat
                </button>
                <button
                  type="button"
                  data-active={wayneView === "clauses" ? "true" : "false"}
                  onClick={() => setWayneView("clauses")}
                >
                  Clause Analysis
                </button>
              </div>
              <span className="muted" style={{ fontSize: "0.75rem" }}>
                {configured === false ? "AI offline" : "Online"}
              </span>
            </div>

            {wayneView === "chat" && (
              <>
                <div className="wayne-panel__body">
                  {!showStartChooser && (
                    <div className="wayne-summary-grid">
                      <div>
                        <span>Involved Parties</span>
                        <strong>{involvedParties}</strong>
                      </div>
                      <div>
                        <span>Total Value</span>
                        <strong>NA</strong>
                      </div>
                      <div>
                        <span>Duration</span>
                        <strong>{duration}</strong>
                      </div>
                      <div>
                        <span>Fields</span>
                        <strong>
                          {filledCount}/{fields.length || 0}
                        </strong>
                      </div>
                    </div>
                  )}

                  {messages.map((message, index) => (
                    <div key={index} className={`msg msg--${message.role}`}>
                      {message.content.split(/(\*\*[^*]+\*\*)/g).map((part, i) => {
                        if (part.startsWith("**") && part.endsWith("**")) {
                          const label = part.slice(2, -2);
                          const isAction =
                            label.toLowerCase().includes("review") ||
                            label.toLowerCase().includes("complete");
                          if (isAction && message.role === "assistant") {
                            return (
                              <button
                                key={i}
                                type="button"
                                className="wayne-inline-action"
                                onClick={() =>
                                  void sendChat(
                                    label.toLowerCase().includes("complete")
                                      ? "Help me complete the contract — propose values for every yellow field."
                                      : "Review and analyse this contract against Capco playbook.",
                                    label.toLowerCase().includes("complete") ? "complete" : "assess",
                                  )
                                }
                              >
                                {label}
                              </button>
                            );
                          }
                          return <strong key={i}>{label}</strong>;
                        }
                        return <span key={i}>{part}</span>;
                      })}
                    </div>
                  ))}

                  {showStartChooser && (
                    <div className="wayne-start">
                      <button
                        type="button"
                        className="wayne-start__card"
                        onClick={() => {
                          setShowStartChooser(false);
                          onBrowseTemplates?.();
                        }}
                      >
                        <strong>Templates</strong>
                        <span>Start from a ready contract and fill in the blanks.</span>
                      </button>
                      <button
                        type="button"
                        className="wayne-start__card"
                        onClick={() => {
                          setShowStartChooser(false);
                          onUploadDocument?.();
                        }}
                      >
                        <strong>Upload</strong>
                        <span>Bring your own document in and I&apos;ll review it.</span>
                      </button>
                      <button
                        type="button"
                        className="wayne-start__card"
                        onClick={() => startAiDraft()}
                      >
                        <strong>Draft with AI</strong>
                        <span>Tell me what you need and I&apos;ll write it for you.</span>
                      </button>
                      <p className="wayne-start__tip muted">
                        You can also use Templates / Upload in the editor toolbar, or type below.
                      </p>
                    </div>
                  )}
                </div>

                <div className="wayne-panel__composer">
                  <button
                    type="button"
                    className="wayne-related"
                    onClick={() => setRelatedOpen((v) => !v)}
                  >
                    Related Queries {relatedQueries.length} {relatedOpen ? "▴" : "▾"}
                  </button>
                  {relatedOpen && (
                    <div className="wayne-related__list">
                      {relatedQueries.map((q) => (
                        <button
                          key={q.label}
                          type="button"
                          onClick={() => void sendChat(q.label, q.mode)}
                        >
                          {q.label}
                        </button>
                      ))}
                    </div>
                  )}
                  <textarea
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    placeholder="Ask, search, or make anything..."
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        void sendChat();
                      }
                    }}
                  />
                  {chatMode === "assess" && (
                    <p className="wayne-assess-hint muted">
                      Assessment mode — uses loaded Capco skills
                      {activeSkill
                        ? ` · ${activeSkill.name || activeSkill.id}`
                        : agreementType
                          ? ` · routing for ${agreementType}`
                          : ""}
                      . Document stays unchanged.
                    </p>
                  )}
                  <div className="wayne-modes">
                    {(
                      [
                        ["assess", "Assessment"],
                        ["improve", "Improve & Act"],
                        ["sources", "Sources"],
                        ["complete", "Complete fields"],
                      ] as const
                    ).map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        data-active={chatMode === id ? "true" : "false"}
                        onClick={() => setChatMode(id)}
                      >
                        {label}
                      </button>
                    ))}
                    <button
                      type="button"
                      className="btn btn--primary wayne-send"
                      disabled={busy}
                      onClick={() => void sendChat(undefined, chatMode)}
                    >
                      {busy ? "…" : "➤"}
                    </button>
                  </div>
                </div>
              </>
            )}

            {wayneView === "clauses" && (
              <div className="wayne-panel__body">
                <div className="wayne-clause-tabs">
                  <button
                    type="button"
                    data-active={clauseTab === "available" ? "true" : "false"}
                    onClick={() => setClauseTab("available")}
                  >
                    Available
                  </button>
                  <button
                    type="button"
                    data-active={clauseTab === "financial" ? "true" : "false"}
                    onClick={() => setClauseTab("financial")}
                  >
                    Financial Terms
                  </button>
                  <button
                    type="button"
                    className="wayne-rerun"
                    onClick={() =>
                      void sendChat(
                        "Produce a clause-by-clause analysis with risks and recommended actions.",
                        "assess",
                      )
                    }
                  >
                    Rerun
                  </button>
                </div>
                {(() => {
                  const visible =
                    clauseTab === "financial"
                      ? clauseSections.filter(
                          (s) =>
                            /fee|payment|value|price|financial|consideration|term/i.test(s.title) ||
                            /fee|payment|value|price|financial|consideration/i.test(s.body),
                        )
                      : clauseSections;
                  if (!visible.length) {
                    return <p className="muted">No financial terms detected in this document.</p>;
                  }
                  return visible.map((section) => {
                    const open = !!openClauses[section.id];
                    return (
                      <div key={section.id} className="wayne-clause">
                        <div className="wayne-clause__head">
                          <button
                            type="button"
                            className="wayne-clause__toggle"
                            onClick={() =>
                              setOpenClauses((current) => ({
                                ...current,
                                [section.id]: !current[section.id],
                              }))
                            }
                          >
                            {open ? "▾" : "▸"} {section.title}
                          </button>
                          <span className="wayne-clause__actions">
                            <button
                              type="button"
                              title="Copy"
                              onClick={() => {
                                void navigator.clipboard.writeText(section.body);
                              }}
                            >
                              ⎘
                            </button>
                          </span>
                        </div>
                        {open && <pre className="wayne-clause__body">{section.body}</pre>}
                      </div>
                    );
                  });
                })()}
              </div>
            )}
          </>
        )}

        {panel === "variables" && (
          <div className="wayne-panel__body">
            <div className="wayne-panel__head">
              <h3>{"{…} Variables"}</h3>
              <button
                type="button"
                className="btn btn--primary"
                disabled={busy}
                onClick={() => void assignVariables()}
              >
                Assign
              </button>
            </div>
            <p className="muted">
              Yellow-highlighted placeholders from the Word template. Filling here tracks completion for Capco Wayne.
            </p>
            {fields.map((field) => (
              <div className="field" key={field.key} style={{ marginBottom: "0.85rem" }}>
                <label htmlFor={`var-${field.key}`}>{field.label || field.placeholder}</label>
                <input
                  id={`var-${field.key}`}
                  value={values[field.key] || ""}
                  placeholder="Enter value..."
                  onChange={(event) =>
                    onValuesChange({ ...values, [field.key]: event.target.value })
                  }
                  onBlur={(event) => {
                    const value = event.target.value.trim();
                    if (value) void Promise.resolve(onApplyFields?.({ [field.key]: value }));
                  }}
                />
              </div>
            ))}
            {!fields.length && <p className="muted">No yellow fields detected in this document.</p>}
          </div>
        )}

        {panel === "workflow" && (
          <div className="wayne-panel__body">
            <div className="wayne-clause-tabs">
              <button
                type="button"
                data-active={workflowTab === "content" ? "true" : "false"}
                onClick={() => setWorkflowTab("content")}
              >
                Content
              </button>
              <button
                type="button"
                data-active={workflowTab === "create" ? "true" : "false"}
                onClick={() => setWorkflowTab("create")}
              >
                Create Workflow
              </button>
            </div>
            {workflowTab === "content" ? (
              <p className="muted">Switch to the document canvas to edit content. Workflow approval steps are under Create Workflow.</p>
            ) : (
              <>
                <div className="wayne-check-approvers">Check Approvers</div>
                <WorkflowStep
                  step={1}
                  title="Collaborators/Approvers"
                  people={approvers}
                  empty="No collaborators yet."
                  onAdd={() => addWorkflowPerson(approvers, setApprovers, "Approver")}
                />
                <WorkflowStep
                  step={2}
                  title="Signatories"
                  people={signatories}
                  empty="No signatories yet. Click + to add."
                  onAdd={() => addWorkflowPerson(signatories, setSignatories, "Signatory")}
                />
                <WorkflowStep
                  step={3}
                  title="CCs"
                  people={ccs}
                  empty="No CCs yet. Click + to add."
                  onAdd={() => addWorkflowPerson(ccs, setCcs, "CC")}
                />
                <div className="wayne-workflow-step">
                  <div className="wayne-workflow-step__head">
                    <strong>4. Post Sign</strong>
                    <button type="button" className="chip">
                      + Add
                    </button>
                  </div>
                  <p className="muted">No flow attached yet. Click + Add to attach one.</p>
                </div>
              </>
            )}
          </div>
        )}

        {panel === "history" && (
          <div className="wayne-panel__body">
            <h3>History</h3>
            <ul className="wayne-history">
              {history.map((item, index) => (
                <li key={`${item}-${index}`}>{item}</li>
              ))}
              {!history.length && <li className="muted">No activity yet.</li>}
            </ul>
          </div>
        )}

        {panel === "comments" && (
          <div className="wayne-panel__body">
            <h3>Comments</h3>
            <p className="muted">
              Threaded comments attach to clause anchors. Native Word comments via EigenPal Pro can plug in later.
            </p>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setPanel("wayne");
                void sendChat("Draft review comments for the riskiest clauses.", "assess");
              }}
            >
              Ask {copilotName} for comment drafts
            </button>
          </div>
        )}

        {panel === "compare" && (
          <div className="wayne-panel__body">
            <h3>Compare</h3>
            <p className="muted">Compare this draft to a prior version or counterparty paper (redline view).</p>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setPanel("wayne");
                void sendChat(
                  "Describe what a redline comparison should focus on for this agreement type.",
                  "assess",
                );
              }}
            >
              Prepare compare checklist
            </button>
          </div>
        )}

        {panel === "version" && (
          <div className="wayne-panel__body">
            <h3>Version</h3>
            <p className="muted">Version 1 · working draft</p>
            <ul className="wayne-history">
              <li>v1 — opened from {agreementType || "template/upload"}</li>
            </ul>
          </div>
        )}

        {panel === "info" && (
          <div className="wayne-panel__body">
            <h3>Info</h3>
            <p>
              <strong>Title:</strong> {title}
            </p>
            <p>
              <strong>Type:</strong> {agreementType || "—"}
            </p>
            <p>
              <strong>Copilot:</strong> {copilotName}
            </p>
            <p className="muted">
              Outputs are drafts for attorney review — not legal advice. GREEN signature paths require a human gate.
            </p>
          </div>
        )}
      </div>
    </aside>
  );
}

function WorkflowStep({
  step,
  title,
  people,
  empty,
  onAdd,
}: {
  step: number;
  title: string;
  people: WorkflowPerson[];
  empty: string;
  onAdd: () => void;
}) {
  return (
    <div className="wayne-workflow-step">
      <div className="wayne-workflow-step__head">
        <strong>
          {step}. {title}
        </strong>
        <button type="button" className="chip" onClick={onAdd}>
          + Add
        </button>
      </div>
      {people.length ? (
        <ul className="wayne-people">
          {people.map((person) => (
            <li key={person.id}>
              <span className="user-chip__avatar">
                {person.name
                  .split(" ")
                  .map((p) => p[0])
                  .join("")
                  .slice(0, 2)
                  .toUpperCase()}
              </span>
              <span>{person.name}</span>
              <span className="badge">{person.role}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">{empty}</p>
      )}
    </div>
  );
}
