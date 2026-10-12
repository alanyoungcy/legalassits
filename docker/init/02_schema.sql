-- Capco Contract Assists — core relational schema
-- Aligns with LEGAL_CONTRACT_COMPLIANCE_DESIGN.md and agent/governance practices.
-- Idempotent: safe to re-run.

BEGIN;

CREATE SCHEMA IF NOT EXISTS app;
CREATE SCHEMA IF NOT EXISTS audit;

-- ---------------------------------------------------------------------------
-- Tenancy & identity
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS app.tenant (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code            TEXT NOT NULL UNIQUE,
    name            TEXT NOT NULL,
    residency_region TEXT NOT NULL DEFAULT 'HK',
    status          TEXT NOT NULL DEFAULT 'active',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.organization (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES app.tenant(id),
    name        TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.business_unit (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES app.tenant(id),
    organization_id UUID REFERENCES app.organization(id),
    name            TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.legal_entity (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES app.tenant(id),
    name        TEXT NOT NULL,
    jurisdiction TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.jurisdiction (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code        TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    region      TEXT
);

CREATE TABLE IF NOT EXISTS app.app_user (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES app.tenant(id),
    email       TEXT NOT NULL,
    display_name TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'active',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, email)
);

CREATE TABLE IF NOT EXISTS app.role (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES app.tenant(id),
    code        TEXT NOT NULL,
    name        TEXT NOT NULL,
    UNIQUE (tenant_id, code)
);

CREATE TABLE IF NOT EXISTS app.user_role (
    user_id     UUID NOT NULL REFERENCES app.app_user(id) ON DELETE CASCADE,
    role_id     UUID NOT NULL REFERENCES app.role(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, role_id)
);

-- ---------------------------------------------------------------------------
-- Matters / requests
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS app.matter (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES app.tenant(id),
    request_ref     TEXT,
    title           TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'draft',
    agreement_type  TEXT,
    legal_entity_id UUID REFERENCES app.legal_entity(id),
    business_unit_id UUID REFERENCES app.business_unit(id),
    governing_law   TEXT,
    counterparty    TEXT,
    owner_user_id   UUID REFERENCES app.app_user(id),
    due_at          TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_matter_tenant_status ON app.matter (tenant_id, status);

CREATE TABLE IF NOT EXISTS app.matter_status_event (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES app.tenant(id),
    matter_id   UUID NOT NULL REFERENCES app.matter(id) ON DELETE CASCADE,
    from_status TEXT,
    to_status   TEXT NOT NULL,
    actor_user_id UUID REFERENCES app.app_user(id),
    reason      TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Templates & yellow fields
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS app.template (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES app.tenant(id),
    code            TEXT NOT NULL,
    name            TEXT NOT NULL,
    agreement_type  TEXT,
    jurisdiction    TEXT,
    entity_scope    TEXT,
    description     TEXT,
    source_filename TEXT,
    source_checksum TEXT,
    status          TEXT NOT NULL DEFAULT 'active',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, code)
);

CREATE TABLE IF NOT EXISTS app.template_version (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES app.tenant(id),
    template_id     UUID NOT NULL REFERENCES app.template(id) ON DELETE CASCADE,
    version_number  INT NOT NULL,
    storage_uri     TEXT NOT NULL,
    checksum        TEXT,
    is_immutable    BOOLEAN NOT NULL DEFAULT TRUE,
    published_at    TIMESTAMPTZ,
    published_by    UUID REFERENCES app.app_user(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (template_id, version_number)
);

CREATE TABLE IF NOT EXISTS app.field_definition (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES app.tenant(id),
    template_version_id UUID NOT NULL REFERENCES app.template_version(id) ON DELETE CASCADE,
    field_key       TEXT NOT NULL,
    label           TEXT NOT NULL,
    placeholder     TEXT,
    field_type      TEXT NOT NULL DEFAULT 'short_text',
    required        BOOLEAN NOT NULL DEFAULT TRUE,
    help_text       TEXT,
    occurrence_count INT NOT NULL DEFAULT 1,
    UNIQUE (template_version_id, field_key)
);

-- ---------------------------------------------------------------------------
-- Documents / contracts
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS app.document_artifact (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES app.tenant(id),
    matter_id       UUID REFERENCES app.matter(id),
    filename        TEXT NOT NULL,
    content_type    TEXT,
    checksum        TEXT,
    storage_uri     TEXT NOT NULL,
    source          TEXT NOT NULL DEFAULT 'upload', -- upload | template | export
    mode            TEXT NOT NULL DEFAULT 'review', -- review | draft
    status          TEXT NOT NULL DEFAULT 'uploaded',
    created_by      UUID REFERENCES app.app_user(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.contract (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES app.tenant(id),
    matter_id       UUID REFERENCES app.matter(id),
    template_id     UUID REFERENCES app.template(id),
    template_version_id UUID REFERENCES app.template_version(id),
    title           TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'draft',
    counterparty    TEXT,
    legal_entity_id UUID REFERENCES app.legal_entity(id),
    governing_law   TEXT,
    created_by      UUID REFERENCES app.app_user(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contract_tenant_status ON app.contract (tenant_id, status);

CREATE TABLE IF NOT EXISTS app.contract_version (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES app.tenant(id),
    contract_id     UUID NOT NULL REFERENCES app.contract(id) ON DELETE CASCADE,
    version_number  INT NOT NULL,
    storage_uri     TEXT,
    editor_document_ref TEXT,
    plain_text      TEXT,
    checksum        TEXT,
    created_by      UUID REFERENCES app.app_user(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (contract_id, version_number)
);

CREATE TABLE IF NOT EXISTS app.field_value (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES app.tenant(id),
    contract_id     UUID NOT NULL REFERENCES app.contract(id) ON DELETE CASCADE,
    contract_version_id UUID REFERENCES app.contract_version(id),
    field_key       TEXT NOT NULL,
    value_text      TEXT,
    state           TEXT NOT NULL DEFAULT 'missing', -- missing|suggested|filled|needs_review|locked
    source          TEXT NOT NULL DEFAULT 'user', -- user|ai|extract|crm
    updated_by      UUID REFERENCES app.app_user(id),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (contract_id, field_key)
);

CREATE TABLE IF NOT EXISTS app.field_value_revision (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES app.tenant(id),
    field_value_id  UUID NOT NULL REFERENCES app.field_value(id) ON DELETE CASCADE,
    old_value       TEXT,
    new_value       TEXT,
    source          TEXT NOT NULL,
    actor_user_id   UUID REFERENCES app.app_user(id),
    contract_version_id UUID REFERENCES app.contract_version(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Skills, playbooks, findings, AI / agent runs (human-gated)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS app.skill_registry (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES app.tenant(id),
    skill_id        TEXT NOT NULL, -- e.g. commercial-legal/nda-review
    plugin          TEXT NOT NULL,
    name            TEXT NOT NULL,
    enabled         BOOLEAN NOT NULL DEFAULT FALSE,
    favorite        BOOLEAN NOT NULL DEFAULT FALSE,
    notes           TEXT,
    source          TEXT NOT NULL DEFAULT 'anthropics/claude-for-legal',
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, skill_id)
);

CREATE TABLE IF NOT EXISTS app.playbook (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES app.tenant(id),
    code            TEXT NOT NULL,
    name            TEXT NOT NULL,
    plugin          TEXT,
    storage_uri     TEXT,
    status          TEXT NOT NULL DEFAULT 'draft',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, code)
);

CREATE TABLE IF NOT EXISTS app.playbook_version (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES app.tenant(id),
    playbook_id     UUID NOT NULL REFERENCES app.playbook(id) ON DELETE CASCADE,
    version_number  INT NOT NULL,
    content_md      TEXT,
    attorney_reviewed BOOLEAN NOT NULL DEFAULT FALSE,
    reviewed_by     UUID REFERENCES app.app_user(id),
    reviewed_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (playbook_id, version_number)
);

CREATE TABLE IF NOT EXISTS app.ai_run (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES app.tenant(id),
    matter_id       UUID REFERENCES app.matter(id),
    contract_id     UUID REFERENCES app.contract(id),
    document_id     UUID REFERENCES app.document_artifact(id),
    skill_id        TEXT,
    mode            TEXT NOT NULL DEFAULT 'understand',
    provider_base_url TEXT,
    model           TEXT,
    status          TEXT NOT NULL DEFAULT 'completed',
    triage          TEXT,
    prompt_tokens   INT,
    completion_tokens INT,
    correlation_id  TEXT,
    request_json    JSONB,
    response_json   JSONB,
    memo_md         TEXT,
    offline         BOOLEAN NOT NULL DEFAULT FALSE,
    created_by      UUID REFERENCES app.app_user(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_run_tenant_created ON app.ai_run (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS app.ai_citation (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES app.tenant(id),
    ai_run_id       UUID NOT NULL REFERENCES app.ai_run(id) ON DELETE CASCADE,
    page            INT,
    quote           TEXT,
    char_start      INT,
    char_end        INT,
    source_ref      TEXT
);

CREATE TABLE IF NOT EXISTS app.finding (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES app.tenant(id),
    ai_run_id       UUID REFERENCES app.ai_run(id) ON DELETE SET NULL,
    contract_id     UUID REFERENCES app.contract(id),
    severity        TEXT NOT NULL, -- GREEN|YELLOW|RED|INFO|ESCALATE
    title           TEXT NOT NULL,
    detail          TEXT,
    recommendation  TEXT,
    citation        TEXT,
    decision        TEXT, -- accepted|dismissed|escalated|pending
    decision_by     UUID REFERENCES app.app_user(id),
    decision_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Agent authority / human gates (from autonomous legal enterprise practices)
CREATE TABLE IF NOT EXISTS app.agent_permission (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES app.tenant(id),
    agent_code      TEXT NOT NULL, -- e.g. capco_wayne, review_router
    action_code     TEXT NOT NULL, -- recommend|draft|index|notify|escalate
    allowed         BOOLEAN NOT NULL DEFAULT FALSE,
    requires_human_gate BOOLEAN NOT NULL DEFAULT TRUE,
    notes           TEXT,
    UNIQUE (tenant_id, agent_code, action_code)
);

CREATE TABLE IF NOT EXISTS app.human_gate (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES app.tenant(id),
    ai_run_id       UUID REFERENCES app.ai_run(id),
    finding_id      UUID REFERENCES app.finding(id),
    gate_type       TEXT NOT NULL, -- approve_green|accept_redline|external_send|escalate
    status          TEXT NOT NULL DEFAULT 'pending',
    requested_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    decided_at      TIMESTAMPTZ,
    decided_by      UUID REFERENCES app.app_user(id),
    decision_note   TEXT
);

-- ---------------------------------------------------------------------------
-- Jobs / outbox / dead letters (RabbitMQ handoff)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS app.job (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES app.tenant(id),
    job_type        TEXT NOT NULL, -- document.extract|ai.review|index.vector|...
    status          TEXT NOT NULL DEFAULT 'queued',
    matter_id       UUID REFERENCES app.matter(id),
    contract_id     UUID REFERENCES app.contract(id),
    document_id     UUID REFERENCES app.document_artifact(id),
    correlation_id  TEXT NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),
    idempotency_key TEXT,
    payload_ref     TEXT, -- object storage reference; not inline document bytes
    error_summary   TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS app.job_attempt (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES app.tenant(id),
    job_id          UUID NOT NULL REFERENCES app.job(id) ON DELETE CASCADE,
    attempt_number  INT NOT NULL,
    worker_id       TEXT,
    status          TEXT NOT NULL,
    started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at     TIMESTAMPTZ,
    error_detail    TEXT,
    UNIQUE (job_id, attempt_number)
);

CREATE TABLE IF NOT EXISTS app.outbox_event (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES app.tenant(id),
    aggregate_type  TEXT NOT NULL,
    aggregate_id    UUID NOT NULL,
    event_type      TEXT NOT NULL,
    payload         JSONB NOT NULL,
    published       BOOLEAN NOT NULL DEFAULT FALSE,
    published_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_outbox_unpublished ON app.outbox_event (published, created_at)
    WHERE published = FALSE;

CREATE TABLE IF NOT EXISTS app.dead_letter_event (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES app.tenant(id),
    job_id          UUID REFERENCES app.job(id),
    queue_name      TEXT,
    payload         JSONB,
    error_detail    TEXT,
    replayed        BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Obligations, projections, audit
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS app.obligation (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES app.tenant(id),
    contract_id     UUID REFERENCES app.contract(id),
    text            TEXT NOT NULL,
    responsible_party TEXT,
    due_at          TIMESTAMPTZ,
    status          TEXT NOT NULL DEFAULT 'open',
    source_clause   TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.embedding_projection (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES app.tenant(id),
    source_type     TEXT NOT NULL, -- clause|playbook|template|document
    source_id       UUID NOT NULL,
    qdrant_collection TEXT NOT NULL,
    qdrant_point_id TEXT NOT NULL,
    index_version   TEXT NOT NULL DEFAULT 'v1',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.graph_projection (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES app.tenant(id),
    neo4j_element_id TEXT NOT NULL,
    source_type     TEXT NOT NULL,
    source_id       UUID NOT NULL,
    index_version   TEXT NOT NULL DEFAULT 'v1',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit.audit_event (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL,
    actor_user_id   UUID,
    action          TEXT NOT NULL,
    entity_type     TEXT NOT NULL,
    entity_id       UUID,
    correlation_id  TEXT,
    details         JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_tenant_created ON audit.audit_event (tenant_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- RLS helpers (enable later per deployment; columns ready now)
-- ---------------------------------------------------------------------------

-- Example policy scaffolding (commented until app sets session GUC):
-- ALTER TABLE app.contract ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY contract_tenant_isolation ON app.contract
--   USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

COMMIT;
