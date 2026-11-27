function stripHtml(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCompare(value: string): string {
  return stripHtml(value)
    .toLowerCase()
    .replace(/^\d+[\.)]\s*/, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function sanitizeComponentInstructions(
  text: unknown,
  steps: Array<string | { stepInstructions?: string }> = [],
): string {
  const raw = String(text || "").trim();
  if (!raw) return "";

  const original = String(text || "");
  const lines = original
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const numbered = lines.filter((line) => /^\d+[\.)]\s+\S/.test(line));
  if (numbered.length >= 2) return "";
  if (/^\s*1[\.)]\s+\S/.test(raw) && /\s+2[\.)]\s+\S/.test(raw)) return "";

  const haystack = normalizeCompare(raw);
  const substantial = steps
    .map((step) =>
      normalizeCompare(typeof step === "string" ? step : String(step?.stepInstructions || "")),
    )
    .filter((step) => step.length >= 24);
  if (substantial.length > 0) {
    const hits = substantial.filter((step) => haystack.includes(step.slice(0, 48)));
    if (hits.length >= Math.min(2, substantial.length)) return "";
  }

  const plain = stripHtml(raw);
  return plain.length <= 160 ? plain : "";
}
