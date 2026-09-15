// Parses a YouTube caption track fetched with &fmt=json3 into plain transcript text.
// Dedupes consecutive identical lines (auto-generated (ASR) tracks repeat rolling text).
export function parseJson3(data) {
  const lines = (data.events || [])
    .map((e) => (e.segs || []).map((s) => s.utf8 || '').join('').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const out = [];
  for (const line of lines) {
    if (line !== out[out.length - 1]) out.push(line);
  }
  return out.join(' ');
}
