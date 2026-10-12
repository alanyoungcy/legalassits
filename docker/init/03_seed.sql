-- Capco Contract Assists — bootstrap seed data

BEGIN;

INSERT INTO app.tenant (id, code, name, residency_region)
VALUES ('11111111-1111-1111-1111-111111111111', 'capco', 'Capco', 'HK')
ON CONFLICT (code) DO NOTHING;

INSERT INTO app.organization (id, tenant_id, name)
VALUES ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'Capco Group')
ON CONFLICT DO NOTHING;

INSERT INTO app.legal_entity (id, tenant_id, name, jurisdiction)
VALUES
    ('33333333-3333-3333-3333-333333333331', '11111111-1111-1111-1111-111111111111', 'Capco Hong Kong Limited', 'Hong Kong'),
    ('33333333-3333-3333-3333-333333333332', '11111111-1111-1111-1111-111111111111', 'Capco UK', 'United Kingdom')
ON CONFLICT DO NOTHING;

INSERT INTO app.jurisdiction (code, name, region) VALUES
    ('HK', 'Hong Kong', 'APAC'),
    ('UK', 'United Kingdom', 'EMEA'),
    ('SG', 'Singapore', 'APAC'),
    ('US', 'United States', 'AMER')
ON CONFLICT (code) DO NOTHING;

INSERT INTO app.app_user (id, tenant_id, email, display_name)
VALUES ('44444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111', 'alan.young@capco.com', 'Alan Young')
ON CONFLICT (tenant_id, email) DO NOTHING;

INSERT INTO app.role (id, tenant_id, code, name) VALUES
    ('55555555-5555-5555-5555-555555555551', '11111111-1111-1111-1111-111111111111', 'legal_reviewer', 'Legal Reviewer'),
    ('55555555-5555-5555-5555-555555555552', '11111111-1111-1111-1111-111111111111', 'requestor', 'Requestor'),
    ('55555555-5555-5555-5555-555555555553', '11111111-1111-1111-1111-111111111111', 'administrator', 'Administrator')
ON CONFLICT (tenant_id, code) DO NOTHING;

INSERT INTO app.user_role (user_id, role_id)
VALUES ('44444444-4444-4444-4444-444444444444', '55555555-5555-5555-5555-555555555551')
ON CONFLICT DO NOTHING;

-- Capco Wayne may recommend/draft; may not send externally or issue GREEN without a human gate
INSERT INTO app.agent_permission (tenant_id, agent_code, action_code, allowed, requires_human_gate, notes) VALUES
    ('11111111-1111-1111-1111-111111111111', 'capco_wayne', 'recommend', TRUE, FALSE, 'May propose findings and field values'),
    ('11111111-1111-1111-1111-111111111111', 'capco_wayne', 'draft', TRUE, FALSE, 'May draft memo / redline language'),
    ('11111111-1111-1111-1111-111111111111', 'capco_wayne', 'index', TRUE, FALSE, 'May enqueue vector/graph indexing'),
    ('11111111-1111-1111-1111-111111111111', 'capco_wayne', 'notify', FALSE, TRUE, 'Notifications require human approval'),
    ('11111111-1111-1111-1111-111111111111', 'capco_wayne', 'external_send', FALSE, TRUE, 'Never auto-send to counterparty'),
    ('11111111-1111-1111-1111-111111111111', 'capco_wayne', 'issue_green', FALSE, TRUE, 'GREEN signature path requires attorney gate')
ON CONFLICT (tenant_id, agent_code, action_code) DO NOTHING;

INSERT INTO app.playbook (id, tenant_id, code, name, plugin, storage_uri, status)
VALUES
    ('66666666-6666-6666-6666-666666666661', '11111111-1111-1111-1111-111111111111', 'commercial-legal', 'Capco Commercial Playbook', 'commercial-legal', 'skills/playbooks/commercial-legal.CLAUDE.md', 'active'),
    ('66666666-6666-6666-6666-666666666662', '11111111-1111-1111-1111-111111111111', 'employment-legal', 'Capco Employment Playbook', 'employment-legal', 'skills/playbooks/employment-legal.CLAUDE.md', 'active')
ON CONFLICT (tenant_id, code) DO NOTHING;

INSERT INTO app.skill_registry (tenant_id, skill_id, plugin, name, enabled, favorite) VALUES
    ('11111111-1111-1111-1111-111111111111', 'commercial-legal/review', 'commercial-legal', 'review', TRUE, TRUE),
    ('11111111-1111-1111-1111-111111111111', 'commercial-legal/nda-review', 'commercial-legal', 'nda-review', TRUE, TRUE),
    ('11111111-1111-1111-1111-111111111111', 'commercial-legal/vendor-agreement-review', 'commercial-legal', 'vendor-agreement-review', TRUE, TRUE),
    ('11111111-1111-1111-1111-111111111111', 'commercial-legal/saas-msa-review', 'commercial-legal', 'saas-msa-review', TRUE, TRUE),
    ('11111111-1111-1111-1111-111111111111', 'employment-legal/hiring-review', 'employment-legal', 'hiring-review', TRUE, TRUE),
    ('11111111-1111-1111-1111-111111111111', 'employment-legal/termination-review', 'employment-legal', 'termination-review', TRUE, TRUE),
    ('11111111-1111-1111-1111-111111111111', 'employment-legal/worker-classification', 'employment-legal', 'worker-classification', TRUE, TRUE)
ON CONFLICT (tenant_id, skill_id) DO NOTHING;

COMMIT;
