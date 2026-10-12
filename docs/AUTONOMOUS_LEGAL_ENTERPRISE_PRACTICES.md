# Autonomous legal enterprise practices → Capco Contract Assists

Reference article: [Architecting the Autonomous Legal Enterprise: From Machine Learning to Multi-Agent Systems](https://medium.com/@adnanmasood/architecting-the-autonomous-legal-enterprise-from-machine-learning-to-multi-agent-systems-b4faf1800a90) (Adnan Masood, PhD, Apr 2026).

Related themes from the same author’s enterprise AI writing: context engineering over brittle prompts, agent permissions / human gates, evaluation & observability, auditability in regulated settings ([License to Act](https://medium.com/@adnanmasood/license-to-act-ai-agents-in-regulated-industries-3dbb1966530b), CoE / LLMOps guidance).

> This note captures practices we should build toward. Some are already scaffolded in schema/UI; others are backlog.

---

## 1. What the article emphasizes (legal ops lens)

Legal ops leverage is no longer only “stand up CLM / e-billing / intake.” The operating questions are:

1. **Which workflows** get automated (intake, review, renewals, obligations)?
2. **Which models** may see privileged / confidential contract data?
3. **Which decisions** stay with humans (GREEN signature, external send, escalation)?
4. **How outcomes are measured** (cycle time, citation coverage, override rate, risk escapes)?

Architecture pillars called out for legal AI: **agentic workflows**, **RAG**, and **AI governance**.

---

## 2. Practices mapped to Capco Contract Assists

| Practice | Why it matters | Status in this repo | Next build step |
| --- | --- | --- | --- |
| Assistive first, autonomy later | Most production legal AI is assistive; full autonomy is rare in regulated work | Capco Wayne drafts / reviews; no auto-send | Keep `agent_permission.external_send = false` |
| Human gates for consequential acts | Nominal approval without evidence is not real oversight | `app.human_gate`, `issue_green` gated in seed | UI: approve GREEN / accept redline before export |
| Explicit agent authority | Agents need a license-to-act matrix | `app.agent_permission` seeded for `capco_wayne` | Enforce in API before side effects |
| Playbook + RAG context pipelines | Context engineering > one-off prompts | Skills + `skills/playbooks/*.md`; Qdrant in compose | Persist embeddings in `embedding_projection`; retrieve before review |
| Multi-agent / skill routing | Specialist skills beat one mega-prompt | commercial/employment skill pack + router | Add orchestrator agent that only routes + logs |
| Evidence before assertion | Citations required for material findings | Design + review memo citations | Store `ai_citation` rows from every AI run |
| Measure the system | Ops owns measurement | Partial (AI run rows) | Dashboards: latency, offline rate, human override, GREEN rate |
| Privileged data controls | Not every model/provider may see every doc | `.env` API_KEY/BASE_URL; residency on tenant | Policy table: classification → allowed providers |
| Durable jobs + outbox | Long work must not hang HTTP | Schema: `job`, `job_attempt`, `outbox_event` | Wire RabbitMQ publishers/consumers |
| Rebuildable projections | Vector/graph are not SoR | `embedding_projection`, `graph_projection` | Rebuild scripts from Postgres + MinIO |
| Append-only audit | Regulated accountability | `audit.audit_event` | Emit on field change, review decision, export |
| Attorney-reviewed playbooks for GREEN | GREEN without reviewed positions is unsafe | Playbook tables + NDA skill guardrails | Block GREEN unless `playbook_version.attorney_reviewed` |

---

## 3. Target multi-agent shape (later)

```text
Capco Wayne (orchestrator / UX copilot)
  ├─ Intake agent      → matter + template selection
  ├─ Field completer   → yellow-field suggestions (human confirm)
  ├─ Review router     → commercial-legal / employment-legal skills
  ├─ NDA / MSA reviewers (skill-backed)
  ├─ Escalation agent  → human_gate + approver routing
  └─ Indexer agent     → Qdrant + Neo4j projections (no legal conclusions)
```

Rules:

- Orchestrator **recommends and drafts**; it does not **act externally**.
- Every agent call writes `ai_run` + optional `finding` + `audit_event`.
- High-impact actions create `human_gate` rows and pause the workflow.

---

## 4. Data schema already created for this path

Applied under Postgres schemas `app` and `audit` (see `docker/init/`):

- Tenancy / identity: `tenant`, `organization`, `legal_entity`, `app_user`, `role`
- CLM core: `matter`, `template`, `template_version`, `field_definition`, `contract`, `contract_version`, `field_value`, `field_value_revision`, `document_artifact`
- AI / agents: `skill_registry`, `playbook`, `playbook_version`, `ai_run`, `ai_citation`, `finding`, `agent_permission`, `human_gate`
- Ops: `job`, `job_attempt`, `outbox_event`, `dead_letter_event`, `obligation`, projections, `audit.audit_event`

Seed includes Capco tenant, Alan Young, commercial/employment playbooks, review skills enabled, and Capco Wayne permission matrix.

---

## 5. Build backlog (prioritized)

1. **Persist AI runs** from `/api/v1/ai/chat` and skill reviews into `ai_run` / `finding`.
2. **Human gate UI** on contract workspace before “Approved for circulation”.
3. **Outbox + RabbitMQ** for upload → extract → review → index.
4. **Qdrant retrieval** into Capco Wayne context (clause + playbook chunks).
5. **Eval harness**: golden NDAs/MSAs, citation coverage, override rate.
6. **Provider policy**: tenant residency + document classification → allowed `BASE_URL`/model.
7. **RLS**: set `app.tenant_id` session GUC; enable policies sketched in schema comments.

---

## 6. Non-goals (for now)

- Fully autonomous signature or counterparty send
- Training foundation models on Capco contract content
- Replacing attorney judgment with GREEN issued by defaults

Every Capco Wayne output remains **a draft for attorney review**, consistent with both our product design and the article’s governance stance.
