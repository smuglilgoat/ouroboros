const FIELDS = ['companionUrl', 'repo', 'branch', 'inboxDir', 'pat'];
chrome.storage.local.get(FIELDS).then((v) => FIELDS.forEach((f) => (document.getElementById(f).value = v[f] ?? '')));
document.getElementById('save').onclick = async () => {
  await chrome.storage.local.set(Object.fromEntries(FIELDS.map((f) => [f, document.getElementById(f).value.trim()])));
  document.getElementById('saved').textContent = 'Saved ✓';
};
