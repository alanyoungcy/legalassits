/** Parse Capco Wayne field assignments from assistant replies. */

export type AssignableField = {
  key: string;
  label: string;
  placeholder: string;
};

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cleanValue(raw: string) {
  return raw
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/\s*\*\*\s*$/g, "")
    .replace(/\s+$/g, "")
    .trim();
}

/** Prefer fenced ```fields blocks; also accept `key: value` lines. */
export function parseAssignedValues(
  reply: string,
  fields: AssignableField[],
): Record<string, string> {
  const next: Record<string, string> = {};
  if (!reply.trim() || !fields.length) return next;

  let body = reply;
  const fenced = reply.match(/```fields\s*([\s\S]*?)```/i);
  if (fenced?.[1]) body = fenced[1];

  const lines = body.split(/\r?\n/);
  for (const field of fields) {
    const aliases = [field.key, field.label, field.placeholder].filter(Boolean);
    for (const alias of aliases) {
      const keyRe = new RegExp(
        `^(?:[-*•]\\s*)?(?:\\*\\*)?(${escapeRegExp(alias)})(?:\\*\\*)?\\s*[:=]\\s*(.+)$`,
        "i",
      );
      for (const line of lines) {
        const match = line.trim().match(keyRe);
        if (match?.[2]) {
          const value = cleanValue(match[2]);
          if (value && !/^\(empty\)$/i.test(value) && value !== "NA") {
            next[field.key] = value;
          }
          break;
        }
      }
      if (next[field.key]) break;
    }
  }
  return next;
}

export function nextEmptyField(
  fields: AssignableField[],
  values: Record<string, string>,
): AssignableField | null {
  return fields.find((f) => !(values[f.key] || "").trim()) || null;
}

export function followUpPrompt(
  fields: AssignableField[],
  values: Record<string, string>,
  appliedCount: number,
  options?: { assignedCount?: number },
): string {
  const empty = fields.filter((f) => !(values[f.key] || "").trim());
  const assignedCount = options?.assignedCount ?? 0;
  const syncFailed = assignedCount > 0 && appliedCount === 0;

  if (syncFailed) {
    const next = empty[0] || fields[0];
    return (
      `I captured ${assignedCount} value(s) in Variables, but they did **not** appear in the Word canvas yet ` +
      `(placeholder text was not found for replace). Try the Variables panel → edit a field and blur, or restate the value.\n\n` +
      (next
        ? `**Next:** Confirm the value for **${next.label || next.placeholder || next.key}**.`
        : "")
    );
  }

  if (!empty.length) {
    return appliedCount
      ? `I've written ${appliedCount} value(s) into the Word document. All yellow fields are filled — say if you want a playbook review next.`
      : "All yellow fields are filled. Want a Capco playbook review?";
  }
  const next = empty[0];
  const remaining = empty
    .slice(0, 6)
    .map((f) => f.label || f.placeholder || f.key)
    .join(", ");
  const wrote = appliedCount
    ? `I've updated the document with ${appliedCount} value(s). `
    : "";
  return (
    `${wrote}` +
    `Still need ${empty.length} field(s): ${remaining}.\n\n` +
    `**Next:** What should I use for **${next.label || next.placeholder || next.key}**?`
  );
}
