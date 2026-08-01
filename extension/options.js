const DEFAULT = 'http://127.0.0.1:7788';
const $ = (id) => document.getElementById(id);
const msg = (text, cls) => { $('msg').textContent = text; $('msg').className = cls || ''; };

chrome.storage.local.get('serverUrl').then(({ serverUrl }) => {
  $('url').value = serverUrl || DEFAULT;
});

$('save').onclick = async () => {
  const url = ($('url').value || DEFAULT).replace(/\/$/, '');
  await chrome.storage.local.set({ serverUrl: url });
  msg('Saved.', 'ok');
};

$('check').onclick = async () => {
  const url = ($('url').value || DEFAULT).replace(/\/$/, '');
  msg('checking…');
  try {
    const r = await fetch(`${url}/health`);
    const h = await r.json();
    const bits = [];
    bits.push(h.hasFacts ? `resume loaded (${h.factsName})` : 'no resume imported yet — open the setup page');
    if (!h.ollama.ok) bits.push('Ollama not reachable — run: ollama serve');
    else if (!h.ollama.present) bits.push(`model ${h.ollama.using} missing — run: ollama pull ${h.ollama.using}`);
    else bits.push(`Ollama ready (${h.ollama.using})`);
    msg(bits.join(' · '), h.hasFacts && h.ollama.ok && h.ollama.present ? 'ok' : 'bad');
  } catch (e) {
    msg(`cannot reach ${url} — is the server running?`, 'bad');
  }
};
