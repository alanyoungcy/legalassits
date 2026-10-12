# Legal review skills

Vendored from [anthropics/claude-for-legal](https://github.com/anthropics/claude-for-legal) (Apache-2.0).

Capco Contract Assists currently ships:

- `vendor/commercial-legal` — vendor/NDA/SaaS review, renewals, escalations
- `vendor/employment-legal` — hiring, termination, classification, policies

Manage enablement in the app **Skills** panel or via `POST /api/v1/skills/{id}/toggle`.

Runtime preferences are stored in `data/skills_state.json` (not committed). Skill source files under `vendor/` should stay aligned with upstream; Capco-specific playbook notes live in `playbooks/`.
