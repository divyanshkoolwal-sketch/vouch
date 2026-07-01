// Extract a JSON object/array from model output that may be fenced or
// prose-wrapped. Shared by all backends so the pipeline never depends on a
// backend emitting perfectly clean JSON.
export function extractJSON(text: string): any {
  let t = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const firstObj = t.indexOf('{');
  const firstArr = t.indexOf('[');
  const start = firstArr >= 0 && (firstObj < 0 || firstArr < firstObj) ? firstArr : firstObj;
  if (start >= 0) {
    const lastObj = t.lastIndexOf('}');
    const lastArr = t.lastIndexOf(']');
    const end = Math.max(lastObj, lastArr);
    if (end > start) t = t.slice(start, end + 1);
  }
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}
