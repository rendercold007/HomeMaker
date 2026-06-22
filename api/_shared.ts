// Shared helpers for Vercel API functions.

export function extractJson(text: string): string | null {
  const stripped = text
    .replace(/^```(?:json)?\s*/im, '')
    .replace(/\s*```\s*$/im, '')
    .trim();
  const start = stripped.indexOf('{');
  const end   = stripped.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  return stripped.slice(start, end + 1);
}
