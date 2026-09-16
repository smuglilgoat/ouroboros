import { parseJson3 } from '../extension/lib/parse.mjs';

const id = 'dQw4w9WgXcQ';
const page = await (
  await fetch('https://www.youtube.com/watch?v=' + id, {
    headers: { 'user-agent': 'Mozilla/5.0', 'accept-language': 'en' },
  })
).text();

// extract ytInitialPlayerResponse = {...}; with a brace scanner
const start = page.indexOf('ytInitialPlayerResponse = ');
if (start === -1) {
  console.log('player response not extractable (page length', page.length + ')');
  process.exit(0);
}
let i = page.indexOf('{', start);
let depth = 0;
for (let j = i; j < page.length; j++) {
  if (page[j] === '{') depth++;
  else if (page[j] === '}') {
    depth--;
    if (depth === 0) { i = j + 1; break; }
  }
}
const pr = JSON.parse(page.slice(page.indexOf('{', start), i));
const track = pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks?.[0];
if (!track) {
  console.log('no captionTracks in player response');
  process.exit(0);
}
console.log('track found, lang:', track.languageCode, 'kind:', track.kind || 'manual');
const r = await fetch(track.baseUrl + '&fmt=json3');
console.log('timedtext fetch:', r.status);
if (r.ok) {
  const t = parseJson3(await r.json());
  console.log('transcript chars:', t.length);
  console.log('sample:', t.slice(0, 120));
}
