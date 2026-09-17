const ta = document.getElementById('extraInstructions');
chrome.storage.local.get(['extraInstructions']).then((v) => (ta.value = v.extraInstructions ?? ''));

document.getElementById('capture').onclick = async () => {
  const status = document.getElementById('status');
  await chrome.storage.local.set({ extraInstructions: ta.value.trim() });
  status.textContent = 'Capturing…';
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const res = await chrome.runtime.sendMessage({ type: 'capture', tabId: tab.id }).catch((e) => ({ ok: false, error: e.message }));
  status.textContent = res.ok
    ? `Sent ✓ (${res.via}${res.ingest ? `, ${res.ingest}` : ''})`
    : `Error: ${res.error}`;
  if (res.ok) setTimeout(() => window.close(), 1500);
};
