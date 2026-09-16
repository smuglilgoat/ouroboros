const DEFAULTS = {
  companionUrl: 'http://localhost:7781/ingest',
  repo: '', // "owner/repo"
  branch: '', // empty = repo default
  inboxDir: 'inbox',
  pat: '',
};

const settings = async () => ({ ...DEFAULTS, ...await chrome.storage.local.get(Object.keys(DEFAULTS)) });

const slugify = (t) =>
  t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'capture';

// Injected into the page's MAIN world; must be fully self-contained AND
// synchronous (async funcs' promises are not reliably awaited by executeScript
// in the MAIN world). Transcript ladder (first success wins), all via sync
// XHR from the page (same-origin, credentialed):
//   1. timedtext with the player response's caption baseUrl
//   2. innerTube get_transcript (what the "Show transcript" panel calls) using
//      params from ytInitialData + real ytcfg context
//   3. fresh innerTube /player request → session-bound caption baseUrl → timedtext
// timedtext/json3 parsing mirrors lib/parse.mjs (unit-tested) — keep in sync.
function captureFunc() {
  const isYT = /(^|\.)youtube\.com$/.test(location.hostname);
  if (isYT) {
    const dedupe = (raw) => {
      const lines = raw.map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
      const out = [];
      for (const l of lines) if (l !== out[out.length - 1]) out.push(l);
      return out.join(' ');
    };
    const parseCaptionBody = (body) => {
      const b = body.trim();
      if (b.startsWith('{')) {
        try {
          const d = JSON.parse(b);
          return dedupe((d.events || []).map((e) => (e.segs || []).map((s) => s.utf8 || '').join('')));
        } catch { return ''; }
      }
      if (b.startsWith('<')) {
        try {
          const doc = new DOMParser().parseFromString(b, 'text/xml');
          return dedupe([...doc.querySelectorAll('text, p')].map((n) => n.textContent));
        } catch { return ''; }
      }
      return '';
    };
    const fetchCaptionText = (baseUrl) => {
      const x = new XMLHttpRequest();
      x.open('GET', baseUrl + '&fmt=json3', false);
      x.send();
      return x.status === 200 ? parseCaptionBody(x.responseText) : '';
    };
    const walkFind = (o, key) => {
      if (!o || typeof o !== 'object') return null;
      if (o[key]) return o[key];
      for (const v of Array.isArray(o) ? o : Object.values(o)) {
        const r = walkFind(v, key);
        if (r) return r;
      }
      return null;
    };
    const collectSegments = (o, acc) => {
      if (Array.isArray(o)) o.forEach((v) => collectSegments(v, acc));
      else if (o && typeof o === 'object') {
        if (o.transcriptSegmentRenderer) acc.push(o.transcriptSegmentRenderer);
        Object.values(o).forEach((v) => collectSegments(v, acc));
      }
    };
    // Pure-JS SHA1 (sync) — must mirror lib/sha1.mjs (unit-tested), keep in sync.
    const sha1 = (str) => {
      const utf8 = unescape(encodeURIComponent(str));
      const n = utf8.length;
      const wordCount = (((n + 8) >> 6) + 1) * 16;
      const words = new Uint32Array(wordCount);
      for (let i = 0; i < n; i++) words[i >> 2] |= utf8.charCodeAt(i) << (24 - (i % 4) * 8);
      words[n >> 2] |= 0x80 << (24 - (n % 4) * 8);
      words[wordCount - 1] = n * 8;
      let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
      const w = new Uint32Array(80);
      const rotl = (x, s) => (x << s) | (x >>> (32 - s));
      for (let i = 0; i < wordCount; i += 16) {
        for (let j = 0; j < 16; j++) w[j] = words[i + j];
        for (let j = 16; j < 80; j++) w[j] = rotl(w[j - 3] ^ w[j - 8] ^ w[j - 14] ^ w[j - 16], 1);
        let a = h0, b = h1, c = h2, d = h3, e = h4;
        for (let j = 0; j < 80; j++) {
          let f, k;
          if (j < 20) { f = (b & c) | (~b & d); k = 0x5a827999; }
          else if (j < 40) { f = b ^ c ^ d; k = 0x6ed9eba1; }
          else if (j < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc; }
          else { f = b ^ c ^ d; k = 0xca62c1d6; }
          const temp = (((a << 5) | (a >>> 27)) + f + e + k + w[j]) | 0;
          e = d; d = c; c = rotl(b, 30); b = a; a = temp;
        }
        h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0; h4 = (h4 + e) | 0;
      }
      const hex = (x) => (x >>> 0).toString(16).padStart(8, '0');
      return hex(h0) + hex(h1) + hex(h2) + hex(h3) + hex(h4);
    };
    // innerTube POSTs from an authed session require SAPISIDHASH (missing →
    // "Precondition check failed" 400). Mirrors youtube.com's own frontend.
    const innerTubeHeaders = () => {
      const h = { 'content-type': 'application/json', 'x-origin': 'https://www.youtube.com' };
      const m = document.cookie.match(/(?:^|;\s*)SAPISID=([^;]+)/);
      if (m) {
        const t = Math.floor(Date.now() / 1000);
        h.authorization = `SAPISIDHASH ${t}_${sha1(t + ' ' + m[1] + ' https://www.youtube.com')}`;
      }
      return h;
    };
    const postInnerTube = (path, body) => {
      const x = new XMLHttpRequest();
      x.open('POST', path, false);
      for (const [k, v] of Object.entries(innerTubeHeaders())) x.setRequestHeader(k, v);
      x.send(JSON.stringify(body));
      return x;
    };

    let pr = null;
    try { pr = window.ytInitialPlayerResponse; } catch {}
    if (!pr?.videoDetails) {
      try { pr = document.getElementById('movie_player').getPlayerResponse(); } catch {}
    }
    const track = pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks?.[0];

    // rung 1: timedtext from the player response's baseUrl
    let transcript = track ? fetchCaptionText(track.baseUrl) : '';
    let dbg = `tt:${track ? 'sent' : 'no-track'}`;

    // rung 2: innerTube get_transcript — same request the "Show transcript"
    // panel makes; params live in ytInitialData
    let gtStatus = 'skipped';
    if (!transcript) {
      try {
        const ctx = window.ytcfg && (window.ytcfg.get ? window.ytcfg.get('INNERTUBE_CONTEXT') : window.ytcfg.data_?.INNERTUBE_CONTEXT);
        const ep = walkFind(window.ytInitialData, 'getTranscriptEndpoint');
        if (ctx && ep?.params) {
          const x = postInnerTube('/youtubei/v1/get_transcript?prettyPrint=false', { context: ctx, params: ep.params });
          gtStatus = String(x.status);
          if (x.status === 200) {
            const segs = [];
            collectSegments(JSON.parse(x.responseText), segs);
            transcript = dedupe(segs.map((s) => (s.snippet?.runs || []).map((r) => r.text || '').join('')));
          }
        } else gtStatus = 'no-ctx/params';
      } catch (e) { gtStatus = 'err:' + String(e.message).slice(0, 40); }
    }

    // rung 3: fresh innerTube /player request → session-bound caption URL
    let plStatus = 'skipped';
    if (!transcript) {
      try {
        const ctx = window.ytcfg && (window.ytcfg.get ? window.ytcfg.get('INNERTUBE_CONTEXT') : window.ytcfg.data_?.INNERTUBE_CONTEXT);
        const videoId = pr?.videoDetails?.videoId || (location.search.match(/[?&]v=([\w-]+)/) || [])[1];
        if (ctx && videoId) {
          const x = postInnerTube('/youtubei/v1/player?prettyPrint=false', { context: ctx, videoId, contentCheckOk: true, racyCheckOk: true });
          plStatus = String(x.status);
          if (x.status === 200) {
            const fresh = JSON.parse(x.responseText);
            const t2 = fresh?.captions?.playerCaptionsTracklistRenderer?.captionTracks?.[0];
            if (t2?.baseUrl) transcript = fetchCaptionText(t2.baseUrl);
          }
        } else plStatus = 'no-ctx/id';
      } catch (e) { plStatus = 'err:' + String(e.message).slice(0, 40); }
    }

    // rung 4: scrape the transcript panel if it's open
    const domSegs = document.querySelectorAll('ytd-transcript-segment-renderer .segment-text');
    let domCount = 0;
    if (!transcript && domSegs.length) {
      transcript = dedupe([...domSegs].map((n) => n.textContent));
      domCount = domSegs.length;
    }

    if (!transcript)
      return {
        ok: false,
        error: `No transcript available. Rungs: ${dbg} gt:${gtStatus} pl:${plStatus} dom:${domCount}. If the panel isn't open, click 'Show transcript' on the video, then capture again.`,
      };
    return {
      ok: true,
      transcript,
      title: pr?.videoDetails?.title || document.title,
      url: location.href,
      source: 'youtube',
    };
  }
  const sel = (window.getSelection() + '').trim();
  const transcript = sel || (document.body?.innerText || '').slice(0, 50000);
  if (!transcript) return { ok: false, error: 'Nothing to capture' };
  return { ok: true, transcript, title: document.title, url: location.href, source: 'page' };
}

async function captureTab(tabId) {
  let injected;
  try {
    [injected] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: captureFunc,
    });
  } catch (e) {
    return { ok: false, error: `Injection failed: ${e.message}` };
  }
  const meta = injected?.result;
  if (!meta) return { ok: false, error: 'Could not access the page' };
  return meta;
}

function toCompanion(s, meta) {
  return fetch(s.companionUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...meta, capturedAt: new Date().toISOString() }),
  })
    .then(async (r) => {
      if (!r.ok) return null;
      const body = await r.json();
      return { ok: true, via: 'companion', ingest: body.ingest };
    })
    .catch(() => null);
}

async function toGithub(s, meta) {
  if (!s.pat || !s.repo) return { ok: false, error: 'Companion unreachable; set PAT + repo in options' };
  const md =
    `---\nsource: ${meta.source}\ntitle: ${JSON.stringify(meta.title)}\nurl: ${meta.url}\n` +
    `captured: ${new Date().toISOString()}\nstatus: unprocessed\n---\n\n${meta.transcript}\n`;
  const bytes = new TextEncoder().encode(md);
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  const date = new Date().toISOString().slice(0, 10);
  const r = await fetch(
    `https://api.github.com/repos/${s.repo}/contents/${s.inboxDir}/${date}-${slugify(meta.title)}.md`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${s.pat}`,
        'content-type': 'application/vnd.github+json',
        accept: 'application/vnd.github+json',
      },
      body: JSON.stringify({
        message: `capture: ${meta.title}`,
        content: btoa(bin),
        ...(s.branch ? { branch: s.branch } : {}),
      }),
    }
  );
  if (!r.ok) return { ok: false, error: `GitHub ${r.status}: ${(await r.text()).slice(0, 120)}` };
  return { ok: true, via: 'github', ingest: 'raw capture only — companion will ingest on next run' };
}

async function sendCapture(tabId) {
  const s = await settings();
  const meta = await captureTab(tabId);
  if (!meta.ok) return meta;
  const viaCompanion = await toCompanion(s, meta);
  if (viaCompanion) return viaCompanion;
  return toGithub(s, meta);
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type !== 'capture') return;
  sendCapture(msg.tabId)
    .then(sendResponse)
    .catch((e) => sendResponse({ ok: false, error: e.message }));
  return true; // keep the message channel open for the async response
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: 'wiki-capture', title: 'Send to wiki', contexts: ['selection', 'page'] });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'wiki-capture' && tab?.id) sendCapture(tab.id);
});
