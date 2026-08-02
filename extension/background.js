const DEFAULT_SERVER = 'http://127.0.0.1:7788';

async function serverUrl() {
  const { serverUrl: u } = await chrome.storage.local.get('serverUrl');
  return u || DEFAULT_SERVER;
}

// The content script never talks to the server directly: requests go out from
// the extension origin, so the page you are browsing cannot reach your resume.
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id || !/^https?:/.test(tab.url || '')) return;
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    await chrome.tabs.sendMessage(tab.id, { type: 'jw-open' });
  } catch (e) {
    console.error('fast-CV: could not open on this page', e);
  }
});

async function streamTailor(port, payload) {
  const base = await serverUrl();
  let res;
  try {
    res = await fetch(`${base}/tailor`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    port.postMessage({ type: 'error', error: `cannot reach fast-CV server at ${base}. Is it running?` });
    return;
  }
  if (!res.ok) {
    let msg = `server returned ${res.status}`;
    try { msg = (await res.json()).error || msg; } catch (e) { /* keep default */ }
    port.postMessage({ type: 'error', error: msg });
    return;
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 2);
      if (!line.startsWith('data: ')) continue;
      try { port.postMessage(JSON.parse(line.slice(6))); } catch (e) { /* skip frame */ }
    }
  }
  port.postMessage({ type: 'stream-end' });
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'fast-cv') return;
  port.onMessage.addListener(async (msg) => {
    if (msg.type === 'tailor') streamTailor(port, msg.payload);
  });
});

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  (async () => {
    const base = await serverUrl();
    if (msg.type === 'jw-base') return reply({ base });

    if (msg.type === 'jw-upload-resume') {
      try {
        const importRes = await fetch(`${base}/import`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ pdfBase64: msg.pdfBase64 }),
        });
        if (!importRes.ok) {
          const text = await importRes.text();
          return reply({ ok: false, error: `Import failed: ${text || importRes.statusText}` });
        }
        const facts = await importRes.json();
        const saveRes = await fetch(`${base}/facts`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(facts),
        });
        if (!saveRes.ok) {
          return reply({ ok: false, error: `Save failed: ${saveRes.statusText}` });
        }
        return reply({ ok: true, name: facts.name });
      } catch (e) {
        return reply({ ok: false, error: e.message });
      }
    }

    if (msg.type === 'jw-health') {
      try {
        const r = await fetch(`${base}/health`);
        return reply({ ok: r.ok, health: await r.json(), base });
      } catch (e) {
        return reply({ ok: false, error: e.message, base });
      }
    }

    if (msg.type === 'jw-save') {
      try {
        const r = await fetch(`${base}/run/${msg.runId}`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(msg.edits),
        });
        return reply({ ok: r.ok, run: await r.json() });
      } catch (e) {
        return reply({ ok: false, error: e.message });
      }
    }

    if (msg.type === 'jw-download') {
      chrome.downloads.download({ url: `${base}/run/${msg.runId}/pdf` });
      return reply({ ok: true });
    }

    if (msg.type === 'jw-open-setup') {
      chrome.tabs.create({ url: `${base}/setup` });
      return reply({ ok: true });
    }

    return reply({ ok: false, error: `unknown message ${msg.type}` });
  })();
  return true;
});
