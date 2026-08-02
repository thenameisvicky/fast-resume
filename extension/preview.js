(() => {
  const params = new URLSearchParams(location.search);
  const runId = params.get('run');
  const base = params.get('base') || 'http://127.0.0.1:7788';
  const fontBase = chrome.runtime.getURL('fonts').replace(/\/$/, '');

  let run = null;
  let ladder = [];
  let availPt = 0;

  const fail = (msg) => {
    const e = document.getElementById('err');
    e.hidden = false;
    e.textContent = msg;
  };

  // Same ladder the server uses for the printed PDF, sent down with the page so
  // the preview can never disagree with the file you download.
  function fit() {
    const page = document.getElementById('jw-page');
    if (!page || !ladder.length) return null;
    const topPad = run && run.layout ? 36 : 36;
    let used = 0;
    let step = 0;
    for (step = 0; step < ladder.length; step++) {
      page.style.wordSpacing = `${ladder[step].ws}pt`;
      page.style.lineHeight = `${ladder[step].lh}pt`;
      const top = page.getBoundingClientRect().top + (topPad * 96) / 72;
      let bottom = 0;
      for (const kid of page.children) {
        const r = kid.getBoundingClientRect();
        if (r.bottom > bottom) bottom = r.bottom;
      }
      used = ((bottom - top) * 72) / 96;
      if (used <= availPt) break;
    }
    if (step >= ladder.length) step = ladder.length - 1;
    const state = {
      fits: used <= availPt,
      compressed: step > 0,
      step,
      usedPt: Math.round(used * 10) / 10,
      availPt: Math.round(availPt * 10) / 10,
      overflowPt: Math.round(Math.max(0, used - availPt) * 10) / 10,
    };
    parent.postMessage({ type: 'jw-fit', fit: state }, '*');
    return state;
  }

  async function load() {
    try {
      const [partsRes, runRes] = await Promise.all([
        fetch(`${base}/run/${runId}/parts?edit=1&fonts=${encodeURIComponent(fontBase)}`),
        fetch(`${base}/run/${runId}`),
      ]);
      if (!partsRes.ok) return fail(`could not load preview (${partsRes.status})`);
      const parts = await partsRes.json();
      run = await runRes.json();
      ladder = parts.ladder;
      availPt = parts.availPt;

      document.querySelectorAll('style[data-jw]').forEach((n) => n.remove());
      const style = document.createElement('style');
      style.setAttribute('data-jw', '1');
      style.textContent = parts.css;
      document.head.appendChild(style);

      const old = document.getElementById('jw-page');
      if (old) old.remove();
      const page = document.createElement('div');
      page.className = 'page';
      page.id = 'jw-page';
      page.innerHTML = parts.body;
      document.body.appendChild(page);

      markFlags(parts.verification);

      if (document.fonts && document.fonts.load) {
        await Promise.all([
          document.fonts.load("10.9pt 'LMRoman10'"),
          document.fonts.load("bold 10.9pt 'LMRoman10'"),
          document.fonts.load("italic 10.9pt 'LMRoman10'"),
          document.fonts.load("bold 17pt 'LMRoman12'"),
        ]);
      }
      fit();
    } catch (e) {
      fail(`cannot reach the fast-CV server at ${base} — ${e.message}`);
    }
  }

  // Red-underline anything the honesty check could not trace back to the resume.
  function markFlags(verification) {
    if (!verification) return;
    const flagged = new Set((verification.flagged || []).map((f) => f.id));
    for (const id of flagged) {
      const node = document.querySelector(`[data-jw="${CSS.escape(id)}"]`);
      if (node) node.classList.add('jw-flag');
    }
  }

  function collect() {
    const map = {};
    for (const node of document.querySelectorAll('[data-jw]')) {
      map[node.getAttribute('data-jw')] = node.textContent.replace(/\s+/g, ' ').trim();
    }
    return map;
  }

  function applyEdits(target, map) {
    const set = (id, apply) => { if (map[id] != null) apply(map[id]); };

    if (target.summary) set(target.summary.id, (v) => { target.summary.text = v; });

    for (const e of target.experience || []) {
      set(`${e.id}:org`, (v) => { e.org = v; });
      set(`${e.id}:role`, (v) => { e.role = v; });
      for (const b of e.bullets || []) set(b.id, (v) => { b.text = v; });
    }
    for (const p of target.projects || []) {
      set(`${p.id}:name`, (v) => { p.name = v; });
      set(`${p.id}:stack`, (v) => { p.stack = v; });
      for (const b of p.bullets || []) set(b.id, (v) => { b.text = v; });
    }
    for (const s of target.skills || []) {
      set(s.id, (v) => { s.items = v.split(',').map((x) => x.trim()).filter(Boolean); });
    }
    return target;
  }

  window.addEventListener('message', (e) => {
    const m = e.data || {};
    if (m.type === 'jw-collect') {
      if (!run) return;
      const edits = applyEdits(JSON.parse(JSON.stringify(run)), collect());
      parent.postMessage({ type: 'jw-edits', edits }, '*');
    }
    if (m.type === 'jw-reload') load();
    if (m.type === 'jw-update') {
      const parts = m.parts;
      run = m.run || run;
      ladder = parts.ladder;
      availPt = parts.availPt;

      document.querySelectorAll('style[data-jw]').forEach((n) => n.remove());
      const style = document.createElement('style');
      style.setAttribute('data-jw', '1');
      style.textContent = parts.css;
      document.head.appendChild(style);

      const old = document.getElementById('jw-page');
      if (old) old.remove();
      const page = document.createElement('div');
      page.className = 'page';
      page.id = 'jw-page';
      page.innerHTML = parts.body;
      document.body.appendChild(page);

      markFlags(parts.verification);

      if (document.fonts && document.fonts.load) {
        Promise.all([
          document.fonts.load("10.9pt 'LMRoman10'"),
          document.fonts.load("bold 10.9pt 'LMRoman10'"),
          document.fonts.load("italic 10.9pt 'LMRoman10'"),
          document.fonts.load("bold 17pt 'LMRoman12'"),
        ]).then(fit);
      } else {
        fit();
      }
    }
  });

  // Re-fit as you type, so overflow shows up while you can still fix it.
  let t = null;
  document.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(fit, 250);
  });

  if (!runId) fail('no run id');
  else if (runId === 'stream') {
    // Just wait for jw-update messages.
  } else load();
})();
