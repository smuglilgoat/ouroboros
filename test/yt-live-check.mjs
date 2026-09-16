import assert from 'node:assert';

const id = process.argv[2] || 'dQw4w9WgXcQ';
const page = await (
  await fetch(`https://www.youtube.com/watch?v=${id}`, {
    headers: { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131 Safari/537.36', 'accept-language': 'en' },
  })
).text();

function extractAfter(marker) {
  const start = page.indexOf(marker);
  if (start === -1) return null;
  let i = page.indexOf('{', start);
  let depth = 0;
  for (let j = i; j < page.length; j++) {
    if (page[j] === '{') depth++;
    else if (page[j] === '}') {
      depth--;
      if (depth === 0) return JSON.parse(page.slice(i, j + 1));
    }
  }
  return null;
}
const walkFind = (o, key) => {
  if (!o || typeof o !== 'object') return null;
  if (o[key]) return o[key];
  for (const v of Array.isArray(o) ? o : Object.values(o)) {
    const r = walkFind(v, key);
    if (r) return r;
  }
  return null;
};

// context: pull the real INNERTUBE_CONTEXT out of the page's ytcfg script
const ytcfgIdx = page.indexOf('"INNERTUBE_CONTEXT":');
let context = null;
if (ytcfgIdx !== -1) {
  const objStart = page.indexOf('{', ytcfgIdx + 18);
  let depth = 0;
  for (let j = objStart; j < page.length; j++) {
    if (page[j] === '{') depth++;
    else if (page[j] === '}') {
      depth--;
      if (depth === 0) {
        try { context = JSON.parse(page.slice(objStart, j + 1)); } catch {}
        break;
      }
    }
  }
}
console.log('context extracted from page ytcfg:', !!context, context?.client?.clientName, context?.client?.clientVersion, 'visitorData:', !!context?.client?.visitorData);

const yti = extractAfter('ytInitialData = ');
const ep = walkFind(yti, 'getTranscriptEndpoint');
assert.ok(ep?.params, 'params found');

const res = await fetch('https://www.youtube.com/youtubei/v1/get_transcript?prettyPrint=false', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131 Safari/537.36',
    'accept-language': 'en',
    origin: 'https://www.youtube.com',
    referer: `https://www.youtube.com/watch?v=${id}`,
  },
  body: JSON.stringify({ context, params: ep.params }),
});
console.log('get_transcript:', res.status);
if (!res.ok) {
  console.log('body:', (await res.text()).slice(0, 300));
  process.exit(1);
}
const data = await res.json();
const segs = [];
const collect = (o) => {
  if (Array.isArray(o)) o.forEach(collect);
  else if (o && typeof o === 'object') {
    if (o.transcriptSegmentRenderer) segs.push(o.transcriptSegmentRenderer);
    Object.values(o).forEach(collect);
  }
};
collect(data);
const text = segs
  .map((s) => ((s.snippet?.runs || []).map((r) => r.text || '').join('')).replace(/\s+/g, ' ').trim())
  .filter(Boolean).join(' ');
console.log('segments:', segs.length, 'chars:', text.length);
console.log('sample:', text.slice(0, 140));
