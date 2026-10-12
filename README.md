# Capco Contract Assists

Chat-first corporate contract workspace for Capco / Wipro legal operations. Capco Wayne is the in-product copilot: complete yellow Word fields live in [EigenPal docx-editor](https://github.com/eigenpal/docx-editor), run skills-based assessments, and research market norms via Brave Search.

Visual language follows [Capco Wealth & Asset Management](https://www.capco.com/Industries/wealth-and-asset-management): black architectural surfaces, Baskerville display type, clean sans UI.

**Repo:** [github.com/alanyoungcy/legalassits](https://github.com/alanyoungcy/legalassits)

---

## Contents

- [Features](#features)
- [Architecture](#architecture)
- [Component map](#component-map)
- [Data flow](#data-flow)
- [Process flows](#process-flows)
- [Install](#install)
- [Configure](#configure)
- [Run](#run)
- [Templates & skills](#templates--skills)
- [API surface](#api-surface)
- [Docker](#docker)
- [Security notes](#security-notes)

---

## Features

| Area | What it does |
| --- | --- |
| **Create** | Blank Word workspace; Capco Wayne offers Templates / Upload / AI draft |
| **Complete fields** | Streaming chat assigns yellow Variables into the live `.docx` |
| **Assessment** | Skills playbook + optional Brave web research; document stays unchanged |
| **Upload & Extract** | Single-file upload → original document preserved → auto skills assessment |
| **Inbox** | Save & exit drafts; reopen from Inbox |
| **Templates** | Browse / upload / manage `.docx` templates with AI blank discovery |
| **Skills** | Enable Capco commercial & employment review skills from `claude-for-legal` |

---

## Architecture

High-level runtime (local default):

```mermaid
flowchart TB
  subgraph Browser
    Web["Next.js 15 frontend<br/>:3000"]
    Editor["EigenPal DocxEditor"]
    Wayne["Capco Wayne panel"]
    Web --> Editor
    Web --> Wayne
  end

  subgraph API["FastAPI backend :8000"]
    Routers["Routers<br/>ai · documents · templates<br/>contracts · skills · reviews"]
    Services["Services<br/>AI · catalog · yellow fields<br/>skills · Brave search · contracts"]
    Routers --> Services
  end

  subgraph Data["Local data + optional infra"]
    FS["templates/ · data/<br/>uploads · contracts · skills state"]
    PG[("Postgres<br/>optional")]
    Qdrant[("Qdrant<br/>optional")]
    Minio[("MinIO<br/>optional")]
  end

  subgraph External
    LLM["LLM API<br/>API_KEY + BASE_URL + MODEL"]
    Brave["Brave Search API<br/>BRAVE_API_KEY"]
  end

  Wayne -->|SSE chat /stream| Routers
  Editor -->|load / save .docx bytes| Routers
  Web -->|REST| Routers
  Services --> FS
  Services -.-> PG
  Services -.-> Qdrant
  Services -.-> Minio
  Services -->|completions| LLM
  Services -->|assessment research| Brave
```

---

## Component map

```mermaid
flowchart LR
  subgraph Frontend["frontend/"]
    Pages["app/<br/>page · create · workspace<br/>inbox · templates · skills"]
    Comp["components/<br/>WorkspaceApp · CapcoWaynePanel<br/>DocxCanvas · HomeChat · InboxApp"]
    Lib["lib/<br/>api.ts · fieldAssign · docReplace"]
    Pages --> Comp --> Lib
  end

  subgraph Backend["backend/app/"]
    Main["main.py"]
    R["routers/"]
    S["services/"]
    Main --> R --> S
  end

  subgraph Skills["skills/"]
    Vendor["vendor/commercial-legal<br/>vendor/employment-legal"]
    Playbooks["playbooks/"]
  end

  Lib -->|HTTP/SSE| R
  S --> Vendor
  S --> Playbooks
```

| Layer | Key pieces |
| --- | --- |
| **UI** | `WorkspaceApp` (scrollable editor + resizable Wayne shell), `DocxCanvas`, `CapcoWaynePanel` |
| **API** | FastAPI under `/api/v1` |
| **AI** | `services/ai.py` — mode-aware prompts (`complete` vs `assess`), skill routing, streaming |
| **Search** | `services/web_search.py` — Brave Web Search for Assessment |
| **Docs** | `documents.py` (preserve original uploads), `yellow_fields.py`, `field_discovery.py`, `docx_package.py` |
| **Catalog** | Template index + upload with AI blank highlighting |
| **Contracts** | Inbox drafts via `contracts/from-workspace` |

---

## Data flow

### Complete yellow fields (live Word sync)

```mermaid
sequenceDiagram
  participant U as User
  participant W as Capco Wayne
  participant API as FastAPI /ai/chat/stream
  participant LLM as LLM provider
  participant Doc as DocxCanvas / fill-fields

  U->>W: Facts (parties, dates, …)
  W->>API: SSE chat (mode=complete)
  API->>LLM: System + fields + document text
  LLM-->>API: Tokens + ```fields``` block
  API-->>W: Stream deltas
  W->>W: parseAssignedValues
  W->>Doc: onApplyFields(values)
  Doc->>API: POST /documents/fill-fields
  API-->>Doc: Filled .docx bytes
  Doc->>Doc: Remount editor with bytes
```

### Assessment (skills + optional Brave; document unchanged)

```mermaid
sequenceDiagram
  participant U as User
  participant W as Capco Wayne
  participant API as FastAPI
  participant Brave as Brave Search
  participant Skills as Skill registry
  participant LLM as LLM provider

  U->>W: Upload & Extract / Assessment
  W->>API: SSE chat (mode=assess)
  API->>Skills: route_review_skill(type, title, text)
  API->>Brave: research_for_assessment (if configured)
  Skills-->>API: Playbook body
  Brave-->>API: Snippets + URLs
  API->>LLM: Assess-only system + skill + research
  LLM-->>API: GREEN/YELLOW/RED findings
  API-->>W: Stream (no field writes)
```

---

## Process flows

### Core workflows (home)

```mermaid
flowchart TD
  Home[My Work home]
  Home --> Sign[Upload and Sign]
  Home --> Create[Create and AI Review]
  Home --> Extract[Upload and Extract]

  Sign -->|upload .docx| WS1[Workspace mode=review]
  Create -->|/create redirect| Blank[Blank workspace mode=create]
  Blank --> T[Templates]
  Blank --> Up[Upload]
  Blank --> AI[Draft with AI]
  Extract -->|upload preserve original| Assess[Workspace mode=assess + autostart]
  Assess --> SkillsReview[Skills risk assessment]
```

### Save & Inbox

```mermaid
flowchart LR
  WS[Workspace] -->|Back| Modal{Leave?}
  Modal -->|Cancel| WS
  Modal -->|Discard| Inbox[Inbox]
  Modal -->|Save and exit| API[POST /contracts/from-workspace]
  API --> Inbox
  Inbox -->|Open| WS2[Workspace?contract=id]
```

---

## Install

### Prerequisites

- **Python 3.11+** (backend venv)
- **Node.js 20+** / npm (frontend)
- Optional: **Docker** for Postgres / Qdrant / Neo4j / RabbitMQ / MinIO

### Clone

```bash
git clone https://github.com/alanyoungcy/legalassits.git
cd legalassits
```

### Backend

```bash
cd backend
python3.11 -m venv .venv
.venv/bin/pip install -r requirements.txt
cd ..
```

### Frontend

```bash
cd frontend
npm install
cd ..
```

### Environment

```bash
cp .env.example .env
```

Edit `.env` — **never commit this file**. Required for Capco Wayne:

| Variable | Purpose |
| --- | --- |
| `API_KEY` | LLM provider API key |
| `BASE_URL` | OpenAI-compatible base URL |
| `MODEL` | Model id |
| `COPILOT_NAME` | Display name (quote if it contains spaces), e.g. `"Capco Wayne"` |
| `BRAVE_API_KEY` | Optional; Assessment web research |
| `NEXT_PUBLIC_API_BASE_URL` | Frontend → API, default `http://localhost:8000` |

---

## Configure

Minimal `.env` shape (values left empty on purpose):

```bash
COPILOT_NAME="Capco Wayne"
API_KEY=
BASE_URL=https://api.openai.com/v1
MODEL=gpt-4o-mini
BRAVE_API_KEY=
BRAVE_SEARCH_ENABLED=true
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
NEXT_PUBLIC_COPILOT_NAME="Capco Wayne"
```

See [`.env.example`](.env.example) for Docker infra defaults.

---

## Run

### Recommended: `dev.sh`

```bash
./scripts/dev.sh start      # API :8000 + web :3000
./scripts/dev.sh status
./scripts/dev.sh stop
./scripts/dev.sh restart
```

Optional infra only:

```bash
./scripts/dev.sh start infra
./scripts/dev.sh stop infra
```

### Manual

```bash
# Terminal A — API
cd backend
.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000

# Terminal B — Web
cd frontend
npm run dev -- --port 3000
```

### URLs

| Service | URL |
| --- | --- |
| App | http://localhost:3000 |
| API health | http://localhost:8000/healthz |
| OpenAPI | http://localhost:8000/docs |
| Logs | `.run/logs/` (when using `dev.sh`) |

---

## Templates & skills

### Yellow fields

Drop `.docx` files under `templates/` (folders allowed). Yellow-highlighted text becomes Variables:

| In Word | Field key |
| --- | --- |
| `[Party Name]` | `party_name` |
| `{{effective_date}}` | `effective_date` |
| `[[CONFIDENTIALITY_TERM]]` | `confidentiality_term` |

Optional sidecar: `my-template.meta.json` next to the `.docx`.

Upload via **Templates** UI also runs AI blank discovery; packages are enriched so EigenPal can open python-docx outputs.

Reindex:

```bash
curl -X POST http://127.0.0.1:8000/api/v1/templates/reindex
```

### Skills

Vendored from [anthropics/claude-for-legal](https://github.com/anthropics/claude-for-legal) (Apache-2.0):

- `skills/vendor/commercial-legal` — NDA / MSA / SaaS / vendor review
- `skills/vendor/employment-legal` — hiring, termination, classification, …

Manage enablement at `/skills`. Capco stubs: `skills/playbooks/`. Assessment mode auto-routes an enabled review skill from agreement type / title / text.

---

## API surface

| Prefix | Role |
| --- | --- |
| `/api/v1/ai` | Chat, SSE stream, status, Brave web-search |
| `/api/v1/documents` | Upload (original preserved), fill-fields, workspace docx |
| `/api/v1/templates` | Catalog, upload, CRUD |
| `/api/v1/contracts` | Drafts / Inbox (`from-workspace`) |
| `/api/v1/skills` | List / toggle / reindex |
| `/api/v1/reviews` | Skill-guided review runs |

---

## Docker

Uses images already on the machine (`pull_policy: never` in compose). Templates mount from `./templates`.

```bash
docker compose up -d                          # infra
docker compose --profile app up -d --build    # api + worker + web
```

Postgres init scripts: `docker/init/` (`01_extensions`, `02_schema`, `03_seed`).

Design / practices backlog: [`docs/LEGAL_CONTRACT_COMPLIANCE_DESIGN.md`](docs/LEGAL_CONTRACT_COMPLIANCE_DESIGN.md), [`docs/AUTONOMOUS_LEGAL_ENTERPRISE_PRACTICES.md`](docs/AUTONOMOUS_LEGAL_ENTERPRISE_PRACTICES.md).

---

## Security notes

- **Do not commit** `.env`, API keys, Brave tokens, or real client documents under `data/uploads` / `data/contracts`.
- `.gitignore` excludes `.env`, `.env.*` (keeps `.env.example`), uploads, contracts, and local indexes.
- Rotate any key that was ever pasted into chat, tickets, or screenshots.
- Assessment mode must not mutate the Word document; completion mode writes Variables only after structured ` ```fields` ` blocks.

---

## License & attribution

- Application code: Capco Contract Assists (project local).
- Review skills: Apache-2.0 via Anthropic `claude-for-legal`.
- Editor: EigenPal `docx-editor` packages.
