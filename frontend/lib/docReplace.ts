/** Build search queries for a yellow-field placeholder so EigenPal find/replace can hit it. */

export function placeholderQueries(raw: string): string[] {
  const base = (raw || "").trim();
  if (!base) return [];
  const noBrackets = base.replace(/^\[+|\]+$/g, "").trim();
  const variants = [
    base,
    ` ${base} `,
    ` ${base}`,
    `${base} `,
    `[${noBrackets}]`,
    ` [${noBrackets}] `,
    `[ ${noBrackets} ]`,
    noBrackets,
  ];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of variants) {
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}
