// parseJson3 lives in lib/parse.mjs (unit-tested); the SW fetches the caption
// track and parses it here.
import { parseJson3 } from './lib/parse.mjs';

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
// in the MAIN world). Caption fetching happens in the service worker, which
// bypasses CORS for hosts in manifest host_permissions.
function captureFunc() {
  const isYT = /(^|\.)youtube\.com$/.test(location.hostname);
  if (isYT) {
    let pr = null;
    try { pr = window.ytInitialPlayerResponse; } catch {}
    if (!pr?.captions) {
      try { pr = document.getElementById('movie_player').getPlayerResponse(); } catch {}
    }
    const track = pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks?.[0];
    if (!track) return { ok: false, error: 'No captions available on this video' };
    return {
      ok: true,
      captionUrl: track.baseUrl,
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
  if (!meta.ok) return meta;
  if (meta.captionUrl) {
    const r = await fetch(meta.captionUrl + '&fmt=json3'); // host permission → no CORS
    if (!r.ok) return { ok: false, error: `Caption fetch failed (${r.status})` };
    meta.transcript = parseJson3(await r.json());
    if (!meta.transcript) return { ok: false, error: 'Caption track was empty' };
  }
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
