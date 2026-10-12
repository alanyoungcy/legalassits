const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "") || "http://localhost:8000";

export type TemplateSummary = {
  id: string;
  name: string;
  filename: string;
  category?: string | null;
  agreement_type?: string | null;
  jurisdiction?: string | null;
  entity_scope?: string | null;
  description?: string | null;
  field_count: number;
  required_field_count: number;
  updated_at?: string | null;
  checksum: string;
  source_path: string;
};

export type TemplateCategory = {
  id: string;
  name: string;
  count: number;
};

export type TemplateField = {
  key: string;
  label: string;
  placeholder: string;
  occurrence_count: number;
  help_text?: string | null;
  required: boolean;
  field_type: string;
  state: string;
  sample_context?: string | null;
};

export type TemplateDetail = TemplateSummary & {
  fields: TemplateField[];
  preview_text?: string | null;
  metadata: Record<string, unknown>;
};

export type ContractSummary = {
  id: string;
  title: string;
  template_id: string;
  template_name: string;
  status: string;
  created_at: string;
  updated_at: string;
  missing_fields: string[];
  filled_field_count: number;
  total_field_count: number;
  download_path?: string | null;
  legal_entity?: string | null;
  governing_law?: string | null;
  counterparty?: string | null;
};

export type ContractDetail = ContractSummary & {
  field_values: Record<string, string>;
  fields: TemplateField[];
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    cache: "no-store",
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export function getApiBase() {
  return API_BASE;
}

export function listTemplates() {
  return request<TemplateSummary[]>("/api/v1/templates");
}

export function reindexTemplates() {
  return request<TemplateSummary[]>("/api/v1/templates/reindex", { method: "POST" });
}

export function getTemplate(id: string) {
  return request<TemplateDetail>(`/api/v1/templates/${id}`);
}

export function updateTemplate(
  id: string,
  body: {
    name?: string;
    category?: string;
    agreement_type?: string;
    jurisdiction?: string;
    entity_scope?: string;
    description?: string;
  },
) {
  return request<TemplateDetail>(`/api/v1/templates/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function deleteTemplate(id: string) {
  return request<{ ok: boolean; id: string }>(`/api/v1/templates/${id}`, {
    method: "DELETE",
  });
}

export function listTemplateCategories() {
  return request<TemplateCategory[]>("/api/v1/templates/categories");
}

export async function fillDocumentFields(body: {
  values: Record<string, string>;
  template_id?: string;
  document_id?: string;
  clear_highlight?: boolean;
}) {
  const response = await fetch(`${API_BASE}/api/v1/documents/fill-fields`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return new Uint8Array(await response.arrayBuffer());
}

export async function uploadTemplate(
  file: File,
  options?: { category?: string; name?: string },
) {
  const body = new FormData();
  body.append("file", file);
  body.append("category", options?.category || "Other");
  if (options?.name) body.append("name", options.name);
  const response = await fetch(`${API_BASE}/api/v1/templates/upload`, {
    method: "POST",
    body,
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json() as Promise<TemplateDetail>;
}

export function listContracts() {
  return request<ContractSummary[]>("/api/v1/contracts");
}

export function getContract(id: string) {
  return request<ContractDetail>(`/api/v1/contracts/${id}`);
}

export function createContract(body: {
  template_id: string;
  title: string;
  field_values: Record<string, string>;
  legal_entity?: string;
  governing_law?: string;
  counterparty?: string;
}) {
  return request<ContractDetail>("/api/v1/contracts", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function saveWorkspaceContract(body: {
  title: string;
  field_values: Record<string, string>;
  template_id?: string;
  document_id?: string;
  agreement_type?: string;
  docx_base64?: string;
  contract_id?: string;
}) {
  return request<ContractDetail>("/api/v1/contracts/from-workspace", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function downloadContractUrl(id: string) {
  return `${API_BASE}/api/v1/contracts/${id}/download`;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export { bytesToBase64 };

export type SkillPlugin = {
  id: string;
  name: string;
  source: string;
  version?: string | null;
  skill_count: number;
  enabled_count: number;
  review_count: number;
};

export type SkillSummary = {
  id: string;
  plugin: string;
  name: string;
  description: string;
  argument_hint?: string | null;
  user_invocable?: boolean;
  plugin_version?: string | null;
  source: string;
  source_path: string;
  enabled: boolean;
  favorite: boolean;
  notes: string;
  review_capable: boolean;
  body_preview?: string;
  headings?: string[];
};

export type ReviewSummary = {
  id: string;
  contract_id: string;
  contract_title: string;
  skill_id: string;
  skill_name: string;
  plugin: string;
  status: string;
  triage?: string | null;
  created_at: string;
  updated_at: string;
  routing: Record<string, unknown>;
  checklist: Array<Record<string, string>>;
  findings: Array<Record<string, string>>;
  memo: string;
  disclaimer: string;
};

export function listSkillPlugins() {
  return request<SkillPlugin[]>("/api/v1/skills/plugins");
}

export function listSkills(params?: {
  plugin?: string;
  enabled_only?: boolean;
  review_only?: boolean;
}) {
  const query = new URLSearchParams();
  if (params?.plugin) query.set("plugin", params.plugin);
  if (params?.enabled_only) query.set("enabled_only", "true");
  if (params?.review_only) query.set("review_only", "true");
  const suffix = query.toString() ? `?${query}` : "";
  return request<SkillSummary[]>(`/api/v1/skills${suffix}`);
}

export function getSkill(id: string, includeBody = false) {
  const query = includeBody ? "?include_body=true" : "";
  return request<SkillSummary & { body?: string }>(
    `/api/v1/skills/${id}${query}`,
  );
}

export function updateSkill(
  id: string,
  body: { enabled?: boolean; favorite?: boolean; notes?: string },
) {
  return request<SkillSummary>(`/api/v1/skills/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function toggleSkill(id: string) {
  return request<SkillSummary>(`/api/v1/skills/${id}/toggle`, { method: "POST" });
}

export function reindexSkills() {
  return request<SkillSummary[]>("/api/v1/skills/reindex", { method: "POST" });
}

export function listReviews(contractId?: string) {
  const query = contractId ? `?contract_id=${encodeURIComponent(contractId)}` : "";
  return request<ReviewSummary[]>(`/api/v1/reviews${query}`);
}

export function createReview(body: {
  contract_id: string;
  skill_id?: string;
  side?: string;
}) {
  return request<ReviewSummary>("/api/v1/reviews", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function getReview(id: string) {
  return request<ReviewSummary>(`/api/v1/reviews/${id}`);
}

export function aiStatus() {
  return request<{
    copilot_name: string;
    provider: string;
    model: string;
    configured: boolean;
  }>("/api/v1/ai/status");
}

export function aiChat(body: {
  messages: Array<{ role: string; content: string }>;
  mode?: string;
  document_title?: string;
  document_text?: string;
  fields?: Array<Record<string, string>>;
  skill_id?: string;
}) {
  return request<{
    role: string;
    content: string;
    provider: string;
    model?: string | null;
    copilot_name: string;
    offline?: boolean;
  }>("/api/v1/ai/chat", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export type AiChatBody = {
  messages: Array<{ role: string; content: string }>;
  mode?: string;
  document_title?: string;
  document_text?: string;
  agreement_type?: string;
  fields?: Array<Record<string, string>>;
  skill_id?: string;
};

export type AiStreamMeta = {
  skill_id?: string;
  skill_name?: string;
  plugin?: string;
};

/** Stream Capco Wayne tokens via SSE. Calls onDelta for each piece; returns full text. */
export async function aiChatStream(
  body: AiChatBody,
  onDelta: (delta: string, full: string) => void,
  signal?: AbortSignal,
  onMeta?: (meta: AiStreamMeta) => void,
): Promise<string> {
  const response = await fetch(`${API_BASE}/api/v1/ai/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(body),
    signal,
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  if (!response.body) {
    throw new Error("No stream body from AI");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let full = "";
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n");
    buffer = parts.pop() || "";
    for (const line of parts) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const raw = trimmed.slice(5).trim();
      if (!raw || raw === "[DONE]") continue;
      let payload: {
        delta?: string;
        done?: boolean;
        error?: string;
        skill_id?: string;
        skill_name?: string;
        plugin?: string;
      };
      try {
        payload = JSON.parse(raw);
      } catch {
        continue;
      }
      if (payload.error) throw new Error(payload.error);
      if (payload.skill_id && onMeta) {
        onMeta({
          skill_id: payload.skill_id,
          skill_name: payload.skill_name,
          plugin: payload.plugin,
        });
      }
      if (payload.delta) {
        full += payload.delta;
        onDelta(payload.delta, full);
      }
    }
  }
  return full;
}

export function getWorkspaceFromTemplate(templateId: string) {
  return request<Record<string, unknown>>(
    `/api/v1/documents/workspace/from-template/${templateId}`,
  );
}

export function getDocument(documentId: string) {
  return request<Record<string, unknown>>(`/api/v1/documents/${documentId}`);
}

export async function uploadDocument(file: File, mode = "review") {
  const body = new FormData();
  body.append("file", file);
  const response = await fetch(
    `${API_BASE}/api/v1/documents/upload?mode=${encodeURIComponent(mode)}`,
    { method: "POST", body },
  );
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json();
}
