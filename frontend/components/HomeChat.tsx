"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { BrowseTemplatesModal } from "@/components/BrowseTemplatesModal";
import { getApiBase, type TemplateSummary } from "@/lib/api";

const QUICK = [
  { label: "NDA", type: "NDA" },
  { label: "MSA", type: "MSA" },
  { label: "SOW", type: "SOW" },
  { label: "Vendor Agreement", type: "Vendor Agreement" },
  { label: "Employment Agreement", type: "Employment" },
  { label: "License Agreement", type: "License Agreement" },
];

const SUGGESTIONS = [
  "Review this vendor MSA against Capco playbook",
  "Help me complete yellow fields in an NDA",
  "Upload a counterparty paper for AI review",
];

export function HomeChat({ templates }: { templates: TemplateSummary[] }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const uploadIntentRef = useRef<"sign" | "assess">("sign");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [browseOpen, setBrowseOpen] = useState(false);
  const copilot = process.env.NEXT_PUBLIC_COPILOT_NAME || "Capco Wayne";

  function pickFile(intent: "sign" | "assess") {
    uploadIntentRef.current = intent;
    fileRef.current?.click();
  }

  function findTemplate(type: string) {
    const lowered = type.toLowerCase();
    return (
      templates.find((t) => (t.agreement_type || "").toLowerCase() === lowered) ||
      templates.find((t) => t.name.toLowerCase().includes(lowered)) ||
      templates[0]
    );
  }

  function startTemplate(type: string) {
    const template = findTemplate(type);
    if (!template) {
      setError("No templates indexed yet. Add .docx files under templates/.");
      return;
    }
    router.push(`/workspace?template=${encodeURIComponent(template.id)}&mode=draft`);
  }

  async function onUpload(
    file: File,
    options?: { mode?: "assess" | "review"; autostart?: boolean },
  ) {
    setBusy(true);
    setError(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const uploadMode = options?.mode || "review";
      const response = await fetch(
        `${getApiBase()}/api/v1/documents/upload?mode=${encodeURIComponent(uploadMode)}`,
        { method: "POST", body },
      );
      if (!response.ok) throw new Error(await response.text());
      const doc = await response.json();
      const params = new URLSearchParams({
        document: doc.id,
        mode: uploadMode === "assess" ? "assess" : uploadMode,
      });
      if (options?.autostart || uploadMode === "assess") params.set("autostart", "assess");
      router.push(`/workspace?${params.toString()}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
      setBusy(false);
    }
  }

  function onSend() {
    const text = prompt.trim();
    if (!text) return;
    const params = new URLSearchParams({ mode: "review", prompt: text });
    router.push(`/workspace?${params.toString()}`);
  }

  return (
    <div className="home">
      <h1>Hey Alan</h1>
      <p className="home__sub">What would you like to accomplish today?</p>

      <div className="quick-starts">
        {QUICK.map((item) => (
          <button key={item.label} type="button" className="pill" onClick={() => startTemplate(item.type)}>
            + {item.label}
          </button>
        ))}
        <button type="button" className="pill pill--link" onClick={() => setBrowseOpen(true)}>
          Browse all templates
        </button>
      </div>

      <div className="chat-card">
        <div className="chat-card__row">
          <div className="wayne-avatar" title={copilot}>
            CW
          </div>
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="What are you looking to do?..."
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                onSend();
              }
            }}
          />
          <button type="button" className="send-btn" onClick={onSend} aria-label="Send">
            ➤
          </button>
        </div>
        <div className="chat-card__actions">
          <button
            type="button"
            className="chip"
            disabled={busy}
            onClick={() => pickFile("assess")}
          >
            + Upload doc
          </button>
          <button type="button" className="chip" onClick={() => router.push("/skills")}>
            Sources
          </button>
          {SUGGESTIONS.map((item) => (
            <button
              key={item}
              type="button"
              className="chip"
              onClick={() => {
                setPrompt(item);
              }}
            >
              {item}
            </button>
          ))}
        </div>
          <input
          ref={fileRef}
          type="file"
          accept=".docx"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            if (uploadIntentRef.current === "assess") {
              void onUpload(file, { mode: "assess", autostart: true });
            } else {
              void onUpload(file, { mode: "review" });
            }
          }}
        />
      </div>
      {error && <p className="muted" style={{ marginTop: "0.75rem" }}>{error}</p>}

      <section className="workflows">
        <h2>Core Workflows</h2>
        <div className="workflow-grid workflow-grid--3">
          <div className="workflow-card workflow-card--blue">
            <div className="workflow-card__top">
              <div className="workflow-card__icon" aria-hidden>
                ✎
              </div>
              <div>
                <div className="workflow-card__label">E-Signature</div>
                <h3>Upload &amp; Sign</h3>
              </div>
            </div>
            <p>
              Send documents for signature, track status in real-time, and get legally binding
              signatures.
            </p>
            <button
              type="button"
              className="workflow-card__cta"
              disabled={busy}
              onClick={() => pickFile("sign")}
            >
              Upload Document
            </button>
          </div>

          <div className="workflow-card workflow-card--green">
            <div className="workflow-card__top">
              <div className="workflow-card__icon" aria-hidden>
                ✦
              </div>
              <div>
                <div className="workflow-card__label">Draft • Review</div>
                <h3>Create &amp; AI Review</h3>
              </div>
            </div>
            <p>
              Draft from scratch or use templates. Redline, collaborate, manage approvals and
              signatures.
            </p>
            <button
              type="button"
              className="workflow-card__cta"
              onClick={() => router.push("/create")}
            >
              Start Drafting
            </button>
          </div>

          <div className="workflow-card workflow-card--pink">
            <div className="workflow-card__top">
              <div className="workflow-card__icon" aria-hidden>
                🔎
              </div>
              <div>
                <div className="workflow-card__label">Obligations • Renewals</div>
                <h3>Upload &amp; Extract</h3>
              </div>
            </div>
            <p>
              Upload one contract. Capco Wayne explains what it is and runs a skills-based risk
              assessment.
            </p>
            <button
              type="button"
              className="workflow-card__cta"
              disabled={busy}
              onClick={() => pickFile("assess")}
            >
              {busy && uploadIntentRef.current === "assess" ? "Uploading…" : "Single file"}
            </button>
          </div>
        </div>
      </section>

      <BrowseTemplatesModal open={browseOpen} onClose={() => setBrowseOpen(false)} />
    </div>
  );
}
