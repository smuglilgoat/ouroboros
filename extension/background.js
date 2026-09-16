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

    let pr = null;
    try { pr = window.ytInitialPlayerResponse; } catch {}
    if (!pr?.videoDetails) {
      try { pr = document.getElementById('movie_player').getPlayerResponse(); } catch {}
    }
    const track = pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks?.[0];

    // rung 1: timedtext from the player response's baseUrl
    let transcript = track ? fetchCaptionText(track.baseUrl) : '';

    // rung 2: innerTube get_transcript — same request the "Show transcript"
    // panel makes; params live in ytInitialData
    if (!transcript) {
      try {
        const ctx = window.ytcfg && (window.ytcfg.get ? window.ytcfg.get('INNERTUBE_CONTEXT') : window.ytcfg.data_?.INNERTUBE_CONTEXT);
        const ep = walkFind(window.ytInitialData, 'getTranscriptEndpoint');
        if (ctx && ep?.params) {
          const x = new XMLHttpRequest();
          x.open('POST', '/youtubei/v1/get_transcript?prettyPrint=false', false);
          x.setRequestHeader('content-type', 'application/json');
          x.send(JSON.stringify({ context: ctx, params: ep.params }));
          if (x.status === 200) {
            const segs = [];
            collectSegments(JSON.parse(x.responseText), segs);
            transcript = dedupe(segs.map((s) => (s.snippet?.runs || []).map((r) => r.text || '').join('')));
          }
        }
      } catch {}
    }

    // rung 3: fresh innerTube /player request → session-bound caption URL
    if (!transcript) {
      try {
        const ctx = window.ytcfg && (window.ytcfg.get ? window.ytcfg.get('INNERTUBE_CONTEXT') : window.ytcfg.data_?.INNERTUBE_CONTEXT);
        const videoId = pr?.videoDetails?.videoId || (location.search.match(/[?&]v=([\w-]+)/) || [])[1];
        if (ctx && videoId) {
          const x = new XMLHttpRequest();
          x.open('POST', '/youtubei/v1/player?prettyPrint=false', false);
          x.setRequestHeader('content-type', 'application/json');
          x.send(JSON.stringify({ context: ctx, videoId, contentCheckOk: true, racyCheckOk: true }));
          if (x.status === 200) {
            const fresh = JSON.parse(x.responseText);
            const t2 = fresh?.captions?.playerCaptionsTracklistRenderer?.captionTracks?.[0];
            if (t2?.baseUrl) transcript = fetchCaptionText(t2.baseUrl);
          }
        }
      } catch {}
    }

    if (!transcript) return { ok: false, error: 'No transcript available (timedtext, get_transcript and player all failed)' };
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
